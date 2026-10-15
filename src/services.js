// Turns paid orders into running services: Minecraft servers on Pterodactyl and
// hosted Discord bots (run by src/bots.js). A background loop compares what each
// order should have with what exists and fixes the difference, retrying failures.
import express from "express";
import { db, now } from "./db.js";
import { isAdmin, requireAdmin, requireUser } from "./auth.js";
import { rateLimit } from "./limit.js";
import { notify } from "./email.js";
import { encrypt, secretsEnabled } from "./secrets.js";
import * as panel from "./pterodactyl.js";

const DAY_MS = 24 * 60 * 60_000;
const GRACE_MS = 7 * DAY_MS;      // canceled servers are kept (suspended) this long
const MAX_ATTEMPTS = 8;
const BOT_PERMISSIONS = "1099780189206"; // from templates/discord-bot/src/lib/permissions.js
const KIND_FOR_PRODUCT = { mcserver: "minecraft", discord: "discord_bot" };

const getService = id => db.prepare("SELECT * FROM services WHERE id = ?").get(Number(id));
export const serviceForOrder = orderId => db.prepare("SELECT * FROM services WHERE order_id = ?").get(orderId);

export const botInviteUrl = appId =>
  `https://discord.com/oauth2/authorize?client_id=${appId}&permissions=${BOT_PERMISSIONS}&integration_type=0&scope=bot+applications.commands`;

// What customers (and, with owner, the site owner) see about a service.
export function publicService(s, { owner = false } = {}) {
  if (!s) return null;
  const out = {
    id: s.id, kind: s.kind, state: s.state, address: s.address,
    panelUrl: s.kind === "minecraft" && process.env.PTERODACTYL_URL && s.panel_identifier
      ? `${process.env.PTERODACTYL_URL.replace(/\/+$/, "")}/server/${s.panel_identifier}` : null,
    bot: s.kind === "discord_bot" ? {
      name: s.bot_name, appId: s.bot_app_id, status: s.bot_status, startedAt: s.bot_started_at,
      inviteUrl: s.bot_app_id ? botInviteUrl(s.bot_app_id) : null,
      log: s.bot_status === "crashed" ? s.log_tail : null,
    } : null,
    deleteAfter: s.delete_after,
  };
  if (owner) Object.assign(out, { lastError: s.last_error, attempts: s.attempts, log: s.log_tail });
  return out;
}

// Called when an order is paid.
export function createServiceForOrder(order) {
  const kind = KIND_FOR_PRODUCT[order.product];
  if (!kind) return;
  const t = now();
  db.prepare(`INSERT OR IGNORE INTO services (order_id, kind, state, next_attempt_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(order.id, kind, kind === "minecraft" ? "provisioning" : "waiting_setup", Date.now(), t, t);
}

function update(id, fields) {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE services SET ${keys.map(k => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .run(...keys.map(k => fields[k]), now(), id);
}

function markDelivered(orderId) {
  const r = db.prepare("UPDATE orders SET status = 'delivered', updated_at = ? WHERE id = ? AND status IN ('paid', 'in_progress')").run(now(), orderId);
  if (r.changes) notify.statusChanged(db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId));
}

// ---------- Minecraft reconcile loop ----------
function desiredState(s, at) {
  const gone = s.order_status === "canceled" || s.subscription_status === "canceled";
  if (gone) {
    const deleteAfter = s.delete_after ?? at + GRACE_MS;
    if (!s.delete_after) update(s.id, { delete_after: deleteAfter });
    return at >= deleteAfter ? "deleted" : "suspended";
  }
  if (["past_due", "paused"].includes(s.subscription_status)) return "suspended";
  return "active";
}

function failed(s, error, at) {
  const attempts = s.attempts + 1;
  const giveUp = s.state === "provisioning" && attempts >= MAX_ATTEMPTS;
  update(s.id, {
    attempts, last_error: String(error.message).slice(0, 500),
    next_attempt_at: at + Math.min(60 * 60_000, 30_000 * 2 ** (attempts - 1)),
    ...(giveUp ? { state: "failed" } : {}),
  });
  console.error(`Service ${s.id} (order ${s.order_id}) failed:`, error.message);
  if (giveUp) notify.provisioningFailed(s.order_id, error.message);
}

async function provision(s) {
  const user = s.user_id && db.prepare("SELECT * FROM users WHERE id = ?").get(s.user_id);
  if (!user) throw new Error("The customer's account was deleted.");
  const [first, ...rest] = user.name.split(" ");
  const panelUser = await panel.ensureUser({
    externalId: `forgecenter-user-${user.id}`,
    email: user.email ?? `user${user.id}@users.forgecenter.invalid`,
    username: `fc${user.id}`, firstName: first, lastName: rest.join(" ") || "Player",
  });
  const server = await panel.ensureServer({
    externalId: `forgecenter-order-${s.order_id}`, name: `ForgeCenter order ${s.order_id}`, userId: panelUser.id,
    limits: {
      memoryMb: Number(process.env.MC_MEMORY_MB) || 2048,
      diskMb: Number(process.env.MC_DISK_MB) || 102400,
      cpuPercent: Number(process.env.MC_CPU_PERCENT) || 100,
    },
  });
  update(s.id, { state: "active", panel_server_id: server.id, panel_identifier: server.identifier, address: server.address,
    attempts: 0, next_attempt_at: null, last_error: null });
  markDelivered(s.order_id);
}

let running = false;
export async function reconcileServices(at = Date.now()) {
  if (running) return;
  running = true;
  try {
    const rows = db.prepare(`SELECT s.*, o.status AS order_status, o.subscription_status, o.user_id
      FROM services s JOIN orders o ON o.id = s.order_id
      WHERE s.kind = 'minecraft' AND s.state IN ('provisioning', 'active', 'suspended')`).all();
    for (const s of rows) {
      if (s.next_attempt_at && s.next_attempt_at > at) continue;
      const desired = desiredState(s, at);
      try {
        if (s.state === "provisioning") {
          if (desired !== "active") { update(s.id, { state: "deleted" }); continue; }
          if (!panel.panelEnabled()) {
            update(s.id, { last_error: "Pterodactyl isn't set up yet. Add the PTERODACTYL_ settings to .env.", next_attempt_at: at + 10 * 60_000 });
            continue;
          }
          await provision(s);
        } else if (desired === "deleted") {
          await panel.deleteServer(s.panel_server_id);
          update(s.id, { state: "deleted", attempts: 0, next_attempt_at: null, last_error: null });
        } else if (desired === "suspended" && s.state === "active") {
          await panel.suspendServer(s.panel_server_id);
          update(s.id, { state: "suspended", attempts: 0, next_attempt_at: null, last_error: null });
        } else if (desired === "active" && s.state === "suspended") {
          await panel.unsuspendServer(s.panel_server_id);
          update(s.id, { state: "active", delete_after: null, attempts: 0, next_attempt_at: null, last_error: null });
        }
      } catch (e) { failed(s, e, at); }
    }
  } finally { running = false; }
}

export function startServiceWorker(intervalMs = 20_000) {
  const tick = () => reconcileServices().catch(e => console.error("Service worker", e));
  tick();
  return setInterval(tick, intervalMs).unref();
}

// ---------- Customer routes ----------
export const servicesRouter = express.Router();

function loadOwnService(req, res, next) {
  const s = getService(req.params.id);
  const order = s && db.prepare("SELECT user_id FROM orders WHERE id = ?").get(s.order_id);
  if (!s || (order.user_id !== req.user.id && !isAdmin(req.user))) return res.status(404).json({ error: "Not found." });
  req.service = s;
  next();
}
const needsActiveServer = (req, res, next) => {
  if (req.service.kind !== "minecraft") return res.status(400).json({ error: "That isn't a Minecraft server." });
  if (req.service.state !== "active") return res.status(409).json({ error: "The server isn't running right now." });
  next();
};

servicesRouter.get("/:id/status", requireUser, loadOwnService, rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  const s = req.service;
  const out = { service: publicService(s, { owner: isAdmin(req.user) }) };
  if (s.kind === "minecraft" && s.state === "active" && process.env.PTERODACTYL_CLIENT_KEY) {
    try { out.resources = await panel.resources(s.panel_identifier); }
    catch (e) { console.error("Server status failed", e.message); out.resourcesError = "Live status isn't available right now."; }
  }
  res.json(out);
});

servicesRouter.post("/:id/power", requireUser, loadOwnService, needsActiveServer, rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  const signal = req.body?.signal;
  if (!["start", "stop", "restart", "kill"].includes(signal)) return res.status(400).json({ error: "Choose start, stop, restart or kill." });
  try { await panel.power(req.service.panel_identifier, signal); res.json({ ok: true }); }
  catch (e) { console.error("Power failed", e.message); res.status(502).json({ error: "The server didn't respond. Try again in a moment." }); }
});

servicesRouter.post("/:id/command", requireUser, loadOwnService, needsActiveServer, rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  const command = String(req.body?.command ?? "").trim().replace(/^\//, "");
  if (!command || command.length > 200 || /[\r\n]/.test(command)) return res.status(400).json({ error: "Enter one command, up to 200 characters." });
  try { await panel.sendCommand(req.service.panel_identifier, command); res.json({ ok: true }); }
  catch (e) {
    console.error("Command failed", e.message);
    res.status(e.status === 502 ? 409 : 502).json({ error: e.status === 502 ? "Start the server first." : "The server didn't respond. Try again in a moment." });
  }
});

// Discord application flags that show which privileged intents are turned on.
const INTENT_MEMBERS = (1 << 14) | (1 << 15);
const INTENT_MESSAGE_CONTENT = (1 << 18) | (1 << 19);

export async function checkBotToken(token) {
  if (!/^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/.test(token)) return { error: "That doesn't look like a bot token. Copy it again from the Bot page." };
  let r;
  try { r = await fetch("https://discord.com/api/v10/applications/@me", { headers: { Authorization: `Bot ${token}` } }); }
  catch { return { error: "Discord didn't answer. Try again in a moment.", status: 502 }; }
  if (r.status === 401) return { error: "Discord says that token isn't valid. Reset it on the Bot page and paste the new one." };
  if (!r.ok) return { error: "Discord didn't answer. Try again in a moment.", status: 502 };
  const appInfo = await r.json();
  if (!(appInfo.flags & INTENT_MEMBERS)) {
    return { error: "Turn on Server Members Intent on the Bot page in the Discord Developer Portal, then try again." };
  }
  return { id: String(appInfo.id), name: appInfo.name, messageContent: !!(appInfo.flags & INTENT_MESSAGE_CONTENT) };
}

servicesRouter.post("/:id/bot", requireUser, loadOwnService, rateLimit({ windowMs: 60_000, max: 5 }), async (req, res) => {
  const s = req.service;
  if (s.kind !== "discord_bot") return res.status(400).json({ error: "That isn't a Discord bot order." });
  if (["deleted", "suspended"].includes(s.state)) return res.status(409).json({ error: "This bot is no longer active." });
  if (!secretsEnabled()) return res.status(503).json({ error: "Bot hosting isn't set up yet. Try again later." });
  const token = String(req.body?.token ?? "").trim();
  const check = await checkBotToken(token);
  if (check.error) return res.status(check.status ?? 400).json({ error: check.error });

  update(s.id, {
    state: "active", bot_token_enc: encrypt(token), bot_app_id: check.id, bot_name: check.name,
    bot_status: "starting", restart_requested: 1, log_tail: null, last_error: null,
    commands_registered: check.id === s.bot_app_id ? s.commands_registered : 0,
  });
  markDelivered(s.order_id);
  res.json({
    service: publicService(getService(s.id)),
    warning: check.messageContent ? null : "Message Content Intent is off, so ticket transcripts won't include message text. You can turn it on later on the Bot page.",
  });
});

servicesRouter.post("/:id/restart", requireUser, loadOwnService, rateLimit({ windowMs: 60_000, max: 5 }), (req, res) => {
  if (req.service.kind !== "discord_bot" || req.service.state !== "active") return res.status(409).json({ error: "This bot isn't running." });
  update(req.service.id, { restart_requested: 1 });
  res.json({ ok: true });
});

// ---------- Owner routes ----------
export const adminServicesRouter = express.Router();
adminServicesRouter.use(requireUser, requireAdmin);

adminServicesRouter.post("/services/:id/retry", (req, res) => {
  const s = getService(req.params.id);
  if (!s) return res.status(404).json({ error: "Not found." });
  update(s.id, { state: s.state === "failed" ? "provisioning" : s.state, attempts: 0, next_attempt_at: Date.now(), restart_requested: s.kind === "discord_bot" ? 1 : 0 });
  if (s.kind === "minecraft") reconcileServices().catch(() => {});
  res.json({ service: publicService(getService(s.id), { owner: true }) });
});
