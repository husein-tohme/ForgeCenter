// Developer API: API keys for calling ForgeCenter from your own code (Claude chat, the
// creator tools and Modrinth search). Nothing is bought up front: each call is paid
// from the key owner's wallet. Keys are for confirmed adults only, because they give
// direct access to Claude and spend money.
//
// The public API lives at /v1 and is mounted before loadUser in app.js: it only ever
// authenticates with "Authorization: Bearer <key>", never a session cookie, so it can
// allow any origin and doesn't need the /api CSRF guard.
import express from "express";
import { randomBytes } from "node:crypto";
import { db, now, walletBalance } from "./db.js";
import { hash, isAdult, requireAdult, requireUser } from "./auth.js";
import { rateLimit } from "./limit.js";
import { addEntry } from "./wallet.js";
import { aiEnabled, ask, textOf } from "./ai.js";
import { modFiles, streamZip } from "./modgen.js";
import { texturePackFiles } from "./texturepack.js";
import { pluginFiles } from "./plugingen.js";
import { gameVersions, isGameVersion, searchMods } from "./modrinth.js";
import { baseUrl } from "./stripe.js";

db.exec(`
-- Only a hash of each key is kept; the key itself is shown once, when it's made.
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS api_keys_user ON api_keys(user_id);

-- One row per charged call. AUTOINCREMENT because wallet entries point here by id
-- (ref api:<id>) and outlive these rows when an account is deleted.
CREATE TABLE IF NOT EXISTS api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS api_usage_user ON api_usage(user_id, created_at);
`);

// Cents. Chat costs twice what Anthropic charges for claude-opus-5-5 ($4 per million
// input tokens, $20 per million output tokens), rounded up to the next cent.
export const PRICING = {
  chat: { model: "claude-opus-5-5", inputPerMillion: 800, outputPerMillion: 4000, minimum: 1, maxTokens: 4096, defaultMaxTokens: 1024 },
  generator: 1,
  search: 1,
};
export const LIMITS = { perMinute: 60, atOnce: 2, maxKeys: 5, systemChars: 8000 };

export const chatCost = (inputTokens, outputTokens) => Math.max(PRICING.chat.minimum,
  Math.ceil((inputTokens * PRICING.chat.inputPerMillion + outputTokens * PRICING.chat.outputPerMillion) / 1_000_000));

const KEY_PATTERN = /^fc_live_[A-Za-z0-9_-]{43}$/;
const newKey = () => "fc_live_" + randomBytes(32).toString("base64url");
const dollars = cents => `$${(cents / 100).toFixed(2)}`;
const zipName = name => String(name || "pack").replace(/\W+/g, "-").replace(/^-|-$/g, "") || "pack";
const fail = (res, status, error) => res.status(status).json({ error });

// Runs fn inside one write transaction, so balance checks and entries can't interleave.
function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try { const out = fn(); db.exec("COMMIT"); return out; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}

// ---------- Paying for calls ----------
// Money set aside for chat calls that are still running, so calls made at the same
// time (from several keys) can't all spend the same balance.
const held = new Map();
const available = userId => walletBalance(userId) - (held.get(userId) ?? 0);
function hold(userId, cents) {
  if (available(userId) < cents) return null;
  held.set(userId, (held.get(userId) ?? 0) + cents);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = held.get(userId) - cents;
    if (left > 0) held.set(userId, left); else held.delete(userId);
  };
}

// Records a finished call and takes its cost from the wallet. It never takes more than
// is left, so the balance can't go below zero even if a chat used more input than estimated.
function charge(key, endpoint, cost, { input = 0, output = 0 } = {}) {
  return transaction(() => {
    const amount = Math.min(cost, Math.max(0, walletBalance(key.user_id)));
    const id = Number(db.prepare(`INSERT INTO api_usage (key_id, user_id, endpoint, input_tokens, output_tokens, cost_cents, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(key.id, key.user_id, endpoint, input, output, amount, now()).lastInsertRowid);
    if (amount > 0) addEntry({ userId: key.user_id, amount: -amount, kind: "api", ref: `api:${id}`, note: `Developer API: ${endpoint}` });
    return amount;
  });
}

const tooLittle = (req, res, cost) => fail(res, 402, `This call can cost up to ${dollars(cost)} and your wallet has ${dollars(Math.max(0, available(req.apiKey.user_id)))} free. Add funds at ${baseUrl(req)}/account#wallet, then try again.`);

// ---------- Public API (/v1) ----------
export const developerApi = express.Router();

// Any website may call the API, because it never uses cookies: a key is the only way in.
developerApi.use((req, res, next) => {
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Expose-Headers": "Content-Disposition, Retry-After, ForgeCenter-Cost-Cents, ForgeCenter-Balance-Cents",
    "Access-Control-Max-Age": "600",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Cache-Control": "no-store",
  });
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

developerApi.use((req, res, next) => {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(req.get("authorization") ?? "");
  if (!match) return fail(res, 401, `Send your API key in the Authorization header: "Bearer fc_live_…". Make a key at ${baseUrl(req)}/developers.`);
  const key = KEY_PATTERN.test(match[1]) && db.prepare(`SELECT k.*, u.name AS account_name, u.age_group FROM api_keys k
    JOIN users u ON u.id = k.user_id WHERE k.key_hash = ?`).get(hash(match[1]));
  if (!key) return fail(res, 401, "That API key isn't valid. Check you copied all of it, or make a new one on the developers page.");
  if (key.revoked_at) return fail(res, 401, "That API key was revoked. Make a new one on the developers page.");
  if (!isAdult(key)) return fail(res, 403, "API keys only work for accounts of confirmed adults.");
  db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(now(), key.id);
  req.apiKey = key;
  next();
});

// Per key: 60 requests a minute, and at most 2 running at once.
const windows = new Map();
const running = new Map();
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [id, w] of windows) if (w.start < cutoff) windows.delete(id);
}, 60_000).unref();

developerApi.use((req, res, next) => {
  const id = req.apiKey.id;
  const t = Date.now();
  let w = windows.get(id);
  if (!w || t - w.start >= 60_000) windows.set(id, w = { start: t, count: 0 });
  if (++w.count > LIMITS.perMinute) {
    res.set("Retry-After", String(Math.max(1, Math.ceil((w.start + 60_000 - t) / 1000))));
    return fail(res, 429, `Each key can make ${LIMITS.perMinute} requests a minute. Wait a moment, then try again.`);
  }
  const busy = running.get(id) ?? 0;
  if (busy >= LIMITS.atOnce) return fail(res, 429, `This key already has ${LIMITS.atOnce} requests running. Wait for one to finish, then try again.`);
  running.set(id, busy + 1);
  let freed = false;
  const free = () => {
    if (freed) return;
    freed = true;
    const left = (running.get(id) ?? 1) - 1;
    if (left > 0) running.set(id, left); else running.delete(id);
  };
  // A call still waiting on Claude or Modrinth keeps its place even if the client hangs
  // up, so dropping connections can't start more than 2 at once.
  res.once("close", () => (res.locals.work ? res.locals.work.then(free, free) : free()));
  next();
});

// For async handlers: remembers the work so the in-flight limit lasts until it ends.
const tracked = fn => (req, res, next) => { res.locals.work = Promise.resolve(fn(req, res)).catch(next); };

const needsJson = (req, res, next) => (req.is("application/json") ? next()
  : fail(res, 415, "Send the body as JSON, with the header Content-Type: application/json."));

developerApi.get("/me", (req, res) => {
  const k = req.apiKey;
  res.json({ key: { name: k.name, prefix: k.prefix }, account: { name: k.account_name }, balance: walletBalance(k.user_id) });
});

// ---------- Chat with Claude ----------
const FORGE_SYSTEM = "You're being called through the ForgeCenter API on behalf of a developer; follow Anthropic's usage policies.";
const EFFORTS = ["low", "medium", "high"];

function chatInput(body) {
  const { messages, system, max_tokens: maxTokens = PRICING.chat.defaultMaxTokens, effort = "low" } = body ?? {};
  if (!Array.isArray(messages) || !messages.length) throw new Error("Send messages: a list of { role, content } turns that starts with the user.");
  if (messages.length > 100) throw new Error("Send up to 100 messages at a time.");
  messages.forEach((m, i) => {
    if (!["user", "assistant"].includes(m?.role) || typeof m.content !== "string" || !m.content.trim()) {
      throw new Error(`Message ${i + 1} needs a role of "user" or "assistant" and some text as its content.`);
    }
  });
  if (messages[0].role !== "user" || messages.at(-1).role !== "user") throw new Error("The first and last messages must be from the user.");
  if (system != null && typeof system !== "string") throw new Error("system must be text.");
  if (system?.length > LIMITS.systemChars) throw new Error(`system can be up to ${LIMITS.systemChars.toLocaleString("en-US")} characters.`);
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > PRICING.chat.maxTokens) {
    throw new Error(`max_tokens must be a whole number from 1 to ${PRICING.chat.maxTokens.toLocaleString("en-US")}.`);
  }
  if (!EFFORTS.includes(effort)) throw new Error(`effort must be "low", "medium" or "high".`);
  return { messages: messages.map(m => ({ role: m.role, content: m.content })), system: system?.trim() || null, maxTokens, effort };
}

developerApi.post("/chat", needsJson, tracked(async (req, res) => {
  if (!aiEnabled()) return fail(res, 503, "AI chat isn't switched on for this site yet. The other endpoints still work.");
  let input;
  try { input = chatInput(req.body); } catch (e) { return fail(res, 400, e.message); }

  // ForgeCenter's own instructions come first; the developer's system text follows.
  const system = [{ type: "text", text: FORGE_SYSTEM }, ...(input.system ? [{ type: "text", text: input.system }] : [])];
  // The most this call can cost: every output token used, and input at 3 characters a token.
  const chars = [...system.map(b => b.text), ...input.messages.map(m => m.content)].reduce((n, s) => n + s.length, 0);
  const worst = chatCost(Math.ceil(chars / 3), input.maxTokens);
  const release = hold(req.apiKey.user_id, worst);
  if (!release) return tooLittle(req, res, worst);

  try {
    let r;
    try {
      r = await ask({ model: PRICING.chat.model, system, messages: input.messages, maxTokens: input.maxTokens, effort: input.effort });
    } catch (e) {
      console.error("Developer API chat failed", e.message);
      return fail(res, 502, "Claude didn't answer, so nothing was charged. Try again in a moment.");
    }
    if (r?.stop_reason === "refusal") return fail(res, 422, "Claude declined this request, so nothing was charged. Change the request and try again.");
    const u = r?.usage ?? {};
    const inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    const outputTokens = u.output_tokens ?? 0;
    const cost = charge(req.apiKey, "chat", chatCost(inputTokens, outputTokens), { input: inputTokens, output: outputTokens });
    res.json({
      reply: textOf(r), stop_reason: r.stop_reason,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      cost_cents: cost, balance: walletBalance(req.apiKey.user_id),
    });
  } catch (e) {
    // For example the database being busy. The charge is one transaction, so it either happened or it didn't.
    console.error("Developer API chat couldn't finish", e.message);
    if (!res.headersSent) fail(res, 500, "Something went wrong on ForgeCenter's side. Check your usage on the developers page before trying again.");
  } finally { release(); }
}));

// ---------- Creator tools (same request bodies as the website's free tools) ----------
function modInput(body) {
  const { name, author, description } = body;
  if (![name, author, description].every(v => typeof v === "string" && v.trim())) {
    throw new Error("Add name, author and description (what the mod adds).");
  }
  const items = Array.isArray(body.items) ? body.items.filter(i => typeof i === "string" && i.trim()).slice(0, 50) : [];
  return modFiles({ ...body, items });
}

function generator(endpoint, build) {
  return (req, res) => {
    const body = req.body ?? {};
    let files;
    try { files = build(body); } catch (e) { return fail(res, 400, e.message); }
    // Building is synchronous, so the balance can't change between this check and the charge.
    if (available(req.apiKey.user_id) < PRICING.generator) return tooLittle(req, res, PRICING.generator);
    const cost = charge(req.apiKey, endpoint, PRICING.generator);
    res.set({ "ForgeCenter-Cost-Cents": String(cost), "ForgeCenter-Balance-Cents": String(walletBalance(req.apiKey.user_id)) });
    streamZip(files, res, zipName(body.name));
  };
}

developerApi.post("/mods", needsJson, generator("mods", modInput));
developerApi.post("/texturepacks", needsJson, generator("texturepacks", texturePackFiles));
developerApi.post("/plugins", needsJson, generator("plugins", pluginFiles));

// ---------- Modrinth search ----------
developerApi.get("/modrinth/search", tracked(async (req, res) => {
  const query = String(req.query.q ?? "").slice(0, 100);
  const kind = req.query.kind ?? "mod";
  if (!["mod", "plugin"].includes(kind)) return fail(res, 400, `kind must be "mod" or "plugin".`);
  let version = req.query.version;
  if (version !== undefined && !isGameVersion(version)) return fail(res, 400, "version must be a Minecraft version, like 1.21.1.");
  const release = hold(req.apiKey.user_id, PRICING.search);
  if (!release) return tooLittle(req, res, PRICING.search);
  try {
    version ??= (await gameVersions())[0];
    const results = await searchMods({ query, gameVersion: version, kind });
    const cost = charge(req.apiKey, "modrinth/search", PRICING.search);
    res.json({ results, version, kind, cost_cents: cost, balance: walletBalance(req.apiKey.user_id) });
  } catch (e) {
    console.error("Developer API search failed", e.message);
    fail(res, 502, "Modrinth didn't answer, so nothing was charged. Try again in a moment.");
  } finally { release(); }
}));

developerApi.use((req, res) => fail(res, 404, `There's no ${req.method} ${req.baseUrl}${req.path}. See ${baseUrl(req)}/developers for the endpoints.`));

// Errors from before the router (a body that isn't valid JSON, or is too big) still get
// CORS headers and a JSON answer, so browser code can read them.
export function developerApiErrors(err, req, res, _next) {
  res.set({ "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
  if (err.type === "entity.parse.failed") return fail(res, 400, "The body isn't valid JSON.");
  if (err.type === "entity.too.large") return fail(res, 413, "The body is too large. Send up to 100 KB.");
  console.error(err);
  fail(res, err.status && err.status < 500 ? err.status : 500, "Something went wrong. Try again in a moment.");
}

// ---------- Key management (the /developers page, signed in) ----------
export const developerRouter = express.Router();

const publicKey = k => ({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.created_at, lastUsedAt: k.last_used_at });

// Prices are public, so the developers page can show them to visitors too.
developerRouter.get("/pricing", (_req, res) => res.json({ pricing: PRICING, limits: LIMITS, ai: aiEnabled() }));

developerRouter.get("/keys", requireUser, (req, res) => {
  const keys = db.prepare(`SELECT id, name, prefix, created_at, last_used_at FROM api_keys
    WHERE user_id = ? AND revoked_at IS NULL ORDER BY id DESC`).all(req.user.id);
  res.json({ keys: keys.map(publicKey), max: LIMITS.maxKeys, canCreate: isAdult(req.user) });
});

developerRouter.post("/keys", requireUser, requireAdult, rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
  const name = String(req.body?.name ?? "").trim().slice(0, 40);
  if (!name) return fail(res, 400, "Give the key a name, like the project it's for.");
  const key = newKey();
  const id = transaction(() => {
    const active = db.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ? AND revoked_at IS NULL").get(req.user.id).n;
    if (active >= LIMITS.maxKeys) return null;
    return Number(db.prepare(`INSERT INTO api_keys (user_id, name, prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(req.user.id, name, key.slice(0, 12), hash(key), now()).lastInsertRowid);
  });
  if (!id) return fail(res, 409, `You have ${LIMITS.maxKeys} keys, the most an account can have. Revoke one you don't use, then try again.`);
  // The only time the key itself is sent: it isn't stored, so it can't be shown again.
  res.status(201).json({ key, ...publicKey(db.prepare("SELECT * FROM api_keys WHERE id = ?").get(id)) });
});

developerRouter.delete("/keys/:id", requireUser, (req, res) => {
  const r = db.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .run(now(), Number(req.params.id), req.user.id);
  if (!r.changes) return fail(res, 404, "That key doesn't exist or is already revoked.");
  res.json({ ok: true });
});

developerRouter.get("/usage", requireUser, (req, res) => {
  const d = new Date();
  const since = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
  const totals = db.prepare(`SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens), 0) AS inputTokens,
    COALESCE(SUM(output_tokens), 0) AS outputTokens, COALESCE(SUM(cost_cents), 0) AS costCents
    FROM api_usage WHERE user_id = ? AND created_at >= ?`).get(req.user.id, since);
  const byEndpoint = db.prepare(`SELECT endpoint, COUNT(*) AS calls, COALESCE(SUM(cost_cents), 0) AS costCents
    FROM api_usage WHERE user_id = ? AND created_at >= ? GROUP BY endpoint ORDER BY costCents DESC, calls DESC`).all(req.user.id, since);
  const recent = db.prepare(`SELECT u.id, u.endpoint, u.input_tokens AS inputTokens, u.output_tokens AS outputTokens,
    u.cost_cents AS costCents, u.created_at AS createdAt, k.name AS keyName, k.prefix AS keyPrefix
    FROM api_usage u JOIN api_keys k ON k.id = u.key_id WHERE u.user_id = ? ORDER BY u.id DESC LIMIT 50`).all(req.user.id);
  res.json({ month: since.slice(0, 7), totals, byEndpoint, recent, balance: walletBalance(req.user.id) });
});
