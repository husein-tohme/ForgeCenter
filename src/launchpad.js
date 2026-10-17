// Game Launchpad: creators make a page for their game (a free draft) and launch it on
// the public games page with a $1-a-month subscription per game. They can cancel any
// time: Stripe keeps the subscription active until the end of the month that was paid
// for, so the game stays up until then, and that month isn't refunded.
// Payment goes through the normal order path: fulfillCheckout() in the webhook marks the
// launch order paid, and a game is live while that order's subscription is active.
import express from "express";
import { addColumn, db, now } from "./db.js";
import { catalog, isAdultOnly } from "./catalog.js";
import { isAdmin, isAdult, requireAdmin, requireUser, requireUserOrSuspended } from "./auth.js";
import { rateLimit } from "./limit.js";
import { getStripe, ensureCustomer, baseUrl, CHECKOUT_LABELS } from "./stripe.js";
import { fulfillCheckout } from "./orders.js";
import { registerReportTarget } from "./reports.js";
import { LIVE } from "./games-live.js";

export { LIVE };

// AUTOINCREMENT because Stripe metadata remembers games by id, so an id is never reused.
db.exec(`
-- A creator's game page. order_id is the launch subscription order (the latest one, as a
-- game can be launched again after a launch ends). cancel_at_period_end and period_end
-- mirror that subscription in Stripe: period_end is when it renews, or ends if canceled.
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL,
  play_url TEXT,
  server_address TEXT,
  trailer_url TEXT,
  icon TEXT NOT NULL,
  accent TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  adult_only INTEGER NOT NULL DEFAULT 0,
  order_id INTEGER REFERENCES orders(id),
  hidden INTEGER NOT NULL DEFAULT 0,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  period_end TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  launched_at TEXT
);
CREATE INDEX IF NOT EXISTS games_user ON games(user_id);
CREATE INDEX IF NOT EXISTS games_order ON games(order_id);
`);
// Set when the site owner marks a game 18+, so its creator can't switch that back off.
addColumn("games", "adult_forced", "INTEGER NOT NULL DEFAULT 0");

// ---------- Choices (the pages read these from /api/games/options) ----------
export const PLATFORMS = {
  "minecraft-server": "Minecraft server", "minecraft-map": "Minecraft map", "minecraft-mod": "Minecraft mod",
  roblox: "Roblox", web: "Web browser", steam: "Steam", itch: "itch.io", other: "Other",
};
// Pixel icons drawn by public/js/launchpad.js (and common.js for the shared ones).
export const GAME_ICONS = ["gamepad", "sword", "trophy", "potion", "heart", "star", "castle", "map",
  "slime", "tnt", "diamond", "grass", "pickaxe", "chest", "rocket", "portal"];
export const ACCENTS = {
  emerald: "Emerald", lapis: "Lapis", redstone: "Redstone", gold: "Gold",
  amethyst: "Amethyst", copper: "Copper", diamond: "Diamond", slate: "Deepslate",
};
export const TAGS = {
  action: "Action", adventure: "Adventure", building: "Building", casual: "Casual", "co-op": "Co-op",
  creative: "Creative", horror: "Horror", minigames: "Minigames", multiplayer: "Multiplayer", parkour: "Parkour",
  puzzle: "Puzzle", pvp: "PvP", racing: "Racing", rpg: "RPG", sandbox: "Sandbox", simulation: "Simulation",
  singleplayer: "Single player", strategy: "Strategy", story: "Story", survival: "Survival",
};
export const LIMITS = { title: 60, tagline: 120, description: 2000, tags: 5, games: 10, link: 300 };

// Shown before paying (on the page and in Stripe Checkout) and again when cancelling.
export const LAUNCH_TERMS = "$1 a month keeps this game on the ForgeCenter games page. Cancel any time from My games: "
  + "it stays up until the end of the month you've paid for, and that month isn't refunded.";

// ---------- The live rule ----------
// LIVE (games-live.js) is the one test for "on the games page", used everywhere. Stripe
// keeps a canceled subscription active until the paid month ends, so a canceled game
// stays up until then; a failed renewal (past_due) or the end of the subscription takes it off.
const PAID = ["paid", "in_progress", "delivered"];

const SELECT = `SELECT g.*, ${LIVE} AS live, u.name AS creator_name,
    o.status AS o_status, o.subscription_status AS o_sub_status, o.stripe_subscription_id AS o_sub_id,
    o.stripe_session_id AS o_session, o.paid_at AS o_paid_at
  FROM games g JOIN users u ON u.id = g.user_id LEFT JOIN orders o ON o.id = g.order_id`;
const getGame = id => db.prepare(`${SELECT} WHERE g.id = ?`).get(Number(id));

// Where a game is, from its creator's point of view.
function launchStatus(g) {
  if (g.hidden) return "hidden";
  if (g.live) return g.cancel_at_period_end ? "ending" : "live";
  const paid = PAID.includes(g.o_status);
  if (paid && ["past_due", "paused"].includes(g.o_sub_status)) return "overdue";
  if (g.o_status === "awaiting_payment") return "checkout";
  return g.launched_at || paid ? "ended" : "draft";
}
// The subscription still renews, so deleting the game would keep charging for nothing.
const renews = g => PAID.includes(g.o_status) && ["active", "past_due", "paused"].includes(g.o_sub_status) && !g.cancel_at_period_end;

const tagsOf = g => { try { return JSON.parse(g.tags); } catch { return []; } };

// What anyone may see. Never the creator's email or the order.
export const publicGame = g => ({
  id: g.id, title: g.title, tagline: g.tagline, description: g.description,
  platform: g.platform, playUrl: g.play_url, serverAddress: g.server_address, trailerUrl: g.trailer_url,
  icon: g.icon, accent: g.accent, tags: tagsOf(g), adultOnly: !!g.adult_only,
  creator: g.creator_name, launchedAt: g.live ? g.launched_at ?? g.o_paid_at : null,
});
// The creator's own view adds where the launch is.
const ownerGame = g => ({
  ...publicGame(g), status: launchStatus(g), live: !!g.live, hidden: !!g.hidden, renews: renews(g),
  cancelAtPeriodEnd: !!g.cancel_at_period_end, periodEnd: g.period_end, orderId: g.order_id,
  createdAt: g.created_at, updatedAt: g.updated_at,
});
// The site owner's view, for moderation.
const adminGame = g => ({ ...publicGame(g), live: !!g.live, hidden: !!g.hidden, status: launchStatus(g) });
// 18+ games, as teens and visitors see them: only that one is there (like the showcase).
const restricted = g => ({ id: g.id, adultOnly: true, restricted: true });

// ---------- Validation ----------
class Invalid extends Error {
  constructor(message, field, status = 400, needs) { super(message); Object.assign(this, { field, status, needs }); }
}

const text = (value, field, name) => {
  if (value == null) return "";
  if (typeof value !== "string") throw new Invalid(`${name} must be text.`, field);
  return value;
};
const oneLine = s => s.replace(/\s+/g, " ").trim();

// http(s) links only, so nothing like javascript: ever reaches a page.
function httpLink(value, field, message) {
  const s = text(value, field, "The link").trim();
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch { throw new Invalid(message, field); }
  if (!/^https?:\/\/\S+$/i.test(s) || !["http:", "https:"].includes(u.protocol) || !u.hostname || u.username || u.password) {
    throw new Invalid(message, field);
  }
  if (u.href.length > LIMITS.link) throw new Invalid(`That link is too long. Use one under ${LIMITS.link} characters.`, field);
  return u.href;
}

const YOUTUBE_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"];
function youtubeLink(value) {
  const message = "The trailer has to be a YouTube link starting with https://, like https://www.youtube.com/watch?v=… or https://youtu.be/….";
  const href = httpLink(value, "trailerUrl", message);
  if (!href) return null;
  const u = new URL(href);
  if (u.protocol !== "https:" || !YOUTUBE_HOSTS.includes(u.hostname) || u.port || u.pathname === "/") throw new Invalid(message, "trailerUrl");
  return href;
}

// A Minecraft server address: a hostname or an IPv4 address, with an optional port.
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
export function serverAddress(value) {
  const s = text(value, "serverAddress", "The server address").trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^([^:\s]+)(?::(\d{1,5}))?$/);
  const port = m?.[2] ? Number(m[2]) : null;
  if (!m || !(HOSTNAME.test(m[1]) || IPV4.test(m[1])) || (port !== null && (port < 1 || port > 65535))) {
    throw new Invalid("Enter the address players type in Minecraft, like play.example.com or play.example.com:25565.", "serverAddress");
  }
  return s;
}

// Reads a create or edit request. For edits, fields that aren't sent keep their values.
function readGame(body = {}, existing, user) {
  const has = key => body[key] !== undefined;
  const pick = (key, column) => (has(key) ? body[key] : existing?.[column]);

  const title = oneLine(text(pick("title", "title"), "title", "The title"));
  if (!title || title.length > LIMITS.title) throw new Invalid(`Give your game a title of up to ${LIMITS.title} characters.`, "title");
  const tagline = oneLine(text(pick("tagline", "tagline"), "tagline", "The tagline"));
  if (tagline.length > LIMITS.tagline) throw new Invalid(`Keep the tagline to ${LIMITS.tagline} characters.`, "tagline");
  const description = text(pick("description", "description"), "description", "The description").replace(/\r\n?/g, "\n").trim();
  if (description.length > LIMITS.description) throw new Invalid(`Keep the description to ${LIMITS.description} characters.`, "description");

  const platform = pick("platform", "platform");
  if (typeof platform !== "string" || !Object.hasOwn(PLATFORMS, platform)) throw new Invalid("Choose where people play your game.", "platform");
  const server = platform === "minecraft-server";
  const playUrl = httpLink(pick("playUrl", "play_url"), "playUrl", "The play link has to start with https:// or http://.");
  // Only Minecraft servers have an address; it's dropped if the platform changes.
  const address = server ? serverAddress(pick("serverAddress", "server_address")) : null;
  if (server && !address) throw new Invalid("Add the address players type in Minecraft to join your server.", "serverAddress");
  if (!server && !playUrl) throw new Invalid("Add a link where people can play or download your game.", "playUrl");
  const trailerUrl = youtubeLink(pick("trailerUrl", "trailer_url"));

  const icon = pick("icon", "icon") ?? "gamepad";
  if (!GAME_ICONS.includes(icon)) throw new Invalid("Pick one of the icons.", "icon");
  const accent = pick("accent", "accent") ?? "emerald";
  if (typeof accent !== "string" || !Object.hasOwn(ACCENTS, accent)) throw new Invalid("Pick one of the colours.", "accent");

  const tags = has("tags") ? body.tags : tagsOf(existing ?? { tags: "[]" });
  if (!Array.isArray(tags) || tags.some(t => typeof t !== "string" || !Object.hasOwn(TAGS, t))) throw new Invalid("Pick tags from the list.", "tags");
  const uniqueTags = [...new Set(tags)];
  if (uniqueTags.length > LIMITS.tags) throw new Invalid(`Choose up to ${LIMITS.tags} tags.`, "tags");

  let adultOnly = !!existing?.adult_only;
  if (has("adultOnly")) {
    if (typeof body.adultOnly !== "boolean") throw new Invalid("adultOnly must be true or false.", "adultOnly");
    if (body.adultOnly && !adultOnly && !isAdult(user)) throw new Invalid("Only confirmed adults can mark a game 18+.", "adultOnly", 403, "adult");
    if (!body.adultOnly && existing?.adult_forced) throw new Invalid("ForgeCenter marked this game 18+, so it stays that way. Open a support ticket if you think that's a mistake.", "adultOnly", 403);
    adultOnly = body.adultOnly;
  }
  return { title, tagline, description, platform, play_url: playUrl, server_address: address, trailer_url: trailerUrl,
    icon, accent, tags: JSON.stringify(uniqueTags), adult_only: adultOnly ? 1 : 0 };
}

// Runs a handler and turns validation problems into a clear 4xx.
const handle = fn => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (e) {
    if (!(e instanceof Invalid)) return next(e);
    res.status(e.status).json({ error: e.message, field: e.field, ...(e.needs ? { needs: e.needs } : {}) });
  }
};

// ---------- Stripe: launches, cancellations and the return page ----------
const toIso = seconds => (Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null);

// Keeps a game in step with its launch subscription: whether it's set to end, and when the
// paid month runs out. Current API versions keep the period on the subscription item.
export function syncLaunchSubscription(sub, orderIdHint = null) {
  const ending = !!(sub.cancel_at_period_end || sub.cancel_at);
  const end = toIso(sub.cancel_at) ?? toIso(sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end);
  db.prepare(`UPDATE games SET cancel_at_period_end = ?, period_end = COALESCE(?, period_end)
    WHERE order_id IN (SELECT id FROM orders WHERE product = 'launch' AND (stripe_subscription_id = ? OR id = ?))`)
    .run(ending ? 1 : 0, end, sub.id, Number(orderIdHint) || 0);
}

// After a launch order is paid: point the game at it and note when it went live. There's
// no work for the site owner, so the order counts as delivered. Returns false when the
// game is gone (deleted, or its account closed) so nothing is left billing for it.
function linkPaidLaunch(orderId, gameId) {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(Number(orderId));
  if (!order || order.product !== "launch" || !PAID.includes(order.status)) return true;
  db.prepare("UPDATE orders SET status = 'delivered', updated_at = ? WHERE id = ? AND status = 'paid'").run(now(), order.id);
  const game = db.prepare(`SELECT g.*, ${LIVE} AS live FROM games g WHERE g.id = ? AND g.user_id = ?`).get(Number(gameId), order.user_id);
  if (!game) return false;
  if (game.order_id !== order.id) {
    // A checkout from an earlier try finished after a newer one started. The payment
    // counts, unless the game is already live on another one: then this second
    // subscription is stopped from renewing, so it isn't billed again for nothing.
    if (game.live) {
      console.error(`Game ${game.id} has two paid launches (orders ${game.order_id} and ${order.id}). Order ${order.id} won't renew; refund it in Stripe.`);
      return false;
    }
    db.prepare("UPDATE games SET order_id = ?, cancel_at_period_end = 0, period_end = NULL WHERE id = ?").run(order.id, game.id);
  }
  const at = order.paid_at ?? now();
  db.prepare("UPDATE games SET launched_at = ? WHERE id = ? AND (launched_at IS NULL OR launched_at < ?)").run(at, game.id, at);
  return true;
}

// A launch was paid for a game that no longer exists, or that's already live on another
// launch: stop it renewing and tell the owner.
async function stopOrphanLaunch(session) {
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  // Already ended (a late or retried event): there's nothing left to stop.
  const order = db.prepare("SELECT subscription_status FROM orders WHERE id = ?").get(Number(session.metadata?.order_id));
  if (order && !["active", "past_due", "paused"].includes(order.subscription_status)) return;
  console.error(`Launch order ${session.metadata?.order_id} was paid for a game that's deleted or already live. Its subscription won't renew; refund it in Stripe if needed.`);
  const stripe = getStripe();
  if (stripe && subId) await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
}

// Stripe events, after handleOrderEvent() has updated the order itself.
export async function handleLaunchEvent(event) {
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      if (obj.metadata?.game_id && !linkPaidLaunch(obj.metadata.order_id, obj.metadata.game_id)) await stopOrphanLaunch(obj);
      return;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      // Includes cancellations and resumes made in the Stripe billing portal.
      return syncLaunchSubscription(obj, obj.metadata?.game_id ? obj.metadata.order_id : null);
  }
}

const expireOrder = orderId => db.prepare("UPDATE orders SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'awaiting_payment'")
  .run(now(), orderId);

// Catches up with a checkout whose webhook hasn't arrived (people land back here first).
// Returns the session's status, or null if it couldn't be read.
async function syncCheckout(stripe, orderId, sessionId, gameId) {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status === "complete") { fulfillCheckout(session); linkPaidLaunch(orderId, gameId); }
    else if (session.status === "expired") expireOrder(orderId);
    return session.status;
  } catch (e) {
    if (e.statusCode === 404) { expireOrder(orderId); return "expired"; }
    console.error("Launch checkout sync failed", e.message);
    return null;
  }
}

// An unfinished checkout from an earlier try is closed before a new one starts (or the
// game is deleted), so one game can't end up with two subscriptions or a paid launch for
// nothing. Returns false if it can't be closed.
async function closeOpenCheckout(stripe, g) {
  const status = await syncCheckout(stripe, g.order_id, g.o_session, g.id);
  if (status === "open") {
    try { await stripe.checkout.sessions.expire(g.o_session); }
    catch (e) { if (e.statusCode !== 404) { console.error("Couldn't close an old launch checkout", e.message); return false; } }
    expireOrder(g.order_id);
    return true;
  }
  return status === "expired";
}

// ---------- Public and creator routes ----------
export const gamesRouter = express.Router();

gamesRouter.get("/options", (_req, res) => {
  const list = map => Object.entries(map).map(([key, name]) => ({ key, name }));
  res.json({ platforms: list(PLATFORMS), icons: GAME_ICONS, accents: list(ACCENTS), tags: list(TAGS),
    limits: LIMITS, price: catalog.launch.monthly, terms: LAUNCH_TERMS });
});

// The public games page: live games only, newest launches first.
gamesRouter.get("/", (req, res) => {
  const platform = String(req.query.platform ?? "");
  const q = String(req.query.q ?? "").trim().slice(0, 60);
  const adult = isAdult(req.user);
  const where = [LIVE], args = [];
  if (platform) {
    if (!Object.hasOwn(PLATFORMS, platform)) return res.status(400).json({ error: "Choose a platform from the list." });
    where.push("g.platform = ?"); args.push(platform);
  }
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
    where.push("(g.title LIKE ? ESCAPE '\\' OR g.tagline LIKE ? ESCAPE '\\' OR g.tags LIKE ? ESCAPE '\\')");
    args.push(like, like, like);
    // People who can't open 18+ games don't need to learn which ones match a search.
    if (!adult) where.push("g.adult_only = 0");
  }
  const rows = db.prepare(`${SELECT} WHERE ${where.join(" AND ")}
    ORDER BY COALESCE(g.launched_at, o.paid_at) DESC, g.id DESC LIMIT 60`).all(...args);
  res.json({ games: rows.map(g => (g.adult_only && !adult ? restricted(g) : publicGame(g))) });
});

gamesRouter.get("/mine", requireUser, handle(async (req, res) => {
  const stripe = getStripe();
  const waiting = db.prepare(`SELECT g.id, g.order_id, o.stripe_session_id FROM games g JOIN orders o ON o.id = g.order_id
    WHERE g.user_id = ? AND o.status = 'awaiting_payment' AND o.stripe_session_id IS NOT NULL ORDER BY o.id DESC LIMIT 3`).all(req.user.id);
  for (const w of stripe ? waiting : []) await syncCheckout(stripe, w.order_id, w.stripe_session_id, w.id);
  const rows = db.prepare(`${SELECT} WHERE g.user_id = ? ORDER BY g.id DESC`).all(req.user.id);
  res.json({ games: rows.map(ownerGame), limit: LIMITS.games, canMarkAdult: isAdult(req.user) });
}));

// A live game, or the creator's own game in any state. The site owner can see any game.
gamesRouter.get("/:id(\\d+)", (req, res) => {
  const g = getGame(req.params.id);
  const mine = !!req.user && g?.user_id === req.user.id;
  const admin = isAdmin(req.user);
  if (!g || (!g.live && !mine && !admin)) return res.status(404).json({ error: "That game isn't on ForgeCenter right now." });
  if (g.adult_only && !mine && !admin && !isAdult(req.user)) return res.json({ game: restricted(g) });
  res.json({ game: mine ? ownerGame(g) : admin ? adminGame(g) : publicGame(g), mine, canModerate: admin });
});

const ownGame = req => {
  const g = getGame(req.params.id);
  return g && g.user_id === req.user.id ? g : null;
};
const notYours = res => res.status(404).json({ error: "Game not found. It may have been deleted." });

gamesRouter.post("/", requireUser, rateLimit({ windowMs: 60_000, max: 20 }), handle((req, res) => {
  const count = db.prepare("SELECT COUNT(*) AS n FROM games WHERE user_id = ?").get(req.user.id).n;
  if (count >= LIMITS.games) return res.status(409).json({ error: `You can have up to ${LIMITS.games} games. Delete one you don't need to make room.` });
  const v = readGame(req.body, null, req.user);
  const t = now();
  const id = Number(db.prepare(`INSERT INTO games (user_id, title, tagline, description, platform, play_url, server_address,
      trailer_url, icon, accent, tags, adult_only, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.user.id, v.title, v.tagline, v.description, v.platform, v.play_url, v.server_address, v.trailer_url,
      v.icon, v.accent, v.tags, v.adult_only, t, t).lastInsertRowid);
  res.status(201).json({ game: ownerGame(getGame(id)) });
}));

// Live games can be edited too: changes show straight away.
gamesRouter.patch("/:id(\\d+)", requireUser, rateLimit({ windowMs: 60_000, max: 30 }), handle((req, res) => {
  const g = ownGame(req);
  if (!g) return notYours(res);
  const v = readGame(req.body, g, req.user);
  db.prepare(`UPDATE games SET title = ?, tagline = ?, description = ?, platform = ?, play_url = ?, server_address = ?,
      trailer_url = ?, icon = ?, accent = ?, tags = ?, adult_only = ?, updated_at = ? WHERE id = ?`)
    .run(v.title, v.tagline, v.description, v.platform, v.play_url, v.server_address, v.trailer_url,
      v.icon, v.accent, v.tags, v.adult_only, now(), g.id);
  res.json({ game: ownerGame(getGame(g.id)) });
}));

const cancelFirst = "Cancel this game's launch first, so you aren't charged again. Then you can delete it.";

gamesRouter.delete("/:id(\\d+)", requireUser, handle(async (req, res) => {
  const g = ownGame(req);
  if (!g) return notYours(res);
  if (renews(g)) return res.status(409).json({ error: cancelFirst });
  const stripe = getStripe();
  if (stripe && g.o_status === "awaiting_payment" && g.o_session && !(await closeOpenCheckout(stripe, g))) {
    // The checkout may have just been paid, or Stripe couldn't be reached.
    if (renews(getGame(g.id))) return res.status(409).json({ error: cancelFirst });
    return res.status(409).json({ error: "Your last checkout for this game is still being processed. Wait a few minutes, then try again." });
  }
  db.prepare("DELETE FROM games WHERE id = ?").run(g.id);
  res.json({ ok: true });
}));

gamesRouter.post("/:id(\\d+)/launch", requireUser, rateLimit({ windowMs: 60_000, max: 10 }), handle(async (req, res) => {
  const g = ownGame(req);
  if (!g) return notYours(res);
  if (g.hidden) return res.status(403).json({ error: "ForgeCenter took this game off the games page, so it can't be launched. Open a support ticket if you think that's a mistake." });
  if (g.live) return res.status(409).json({ error: "This game is already live." });
  if (launchStatus(g) === "overdue") {
    return res.status(409).json({ error: "Your last payment for this game didn't go through. Update your card in Manage billing and it comes back by itself.", needs: "billing" });
  }
  const item = catalog.launch;
  if (isAdultOnly("launch") && !isAdult(req.user)) return res.status(403).json({ error: "Confirm you're an adult to launch a game.", needs: "adult" });
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: "Payments aren't set up yet." });

  if (g.o_status === "awaiting_payment" && g.o_session && !(await closeOpenCheckout(stripe, g))) {
    const fresh = getGame(g.id);
    if (fresh.live) return res.status(409).json({ error: "Your payment already went through, so this game is live.", game: ownerGame(fresh) });
    return res.status(409).json({ error: "Your last checkout for this game is still being processed. Wait a few minutes, then reload this page." });
  }

  let orderId;
  try {
    const customer = await ensureCustomer(stripe, req.user);
    const t = now();
    orderId = Number(db.prepare(`INSERT INTO orders (user_id, product, amount, monthly, status, created_at, updated_at)
      VALUES (?, 'launch', 0, ?, 'awaiting_payment', ?, ?)`).run(req.user.id, item.monthly, t, t).lastInsertRowid);
    const metadata = { kind: "order", order_id: String(orderId), game_id: String(g.id) };
    const session = await stripe.checkout.sessions.create({
      mode: "subscription", customer,
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: item.monthly, recurring: { interval: "month" },
        product_data: { name: `${item.monthlyName}: ${g.title}`, description: "Your game on the ForgeCenter games page." } } }],
      client_reference_id: String(orderId), metadata, subscription_data: { metadata },
      custom_text: { submit: { message: LAUNCH_TERMS } },
      success_url: `${baseUrl(req)}/my-games?launched=${g.id}`,
      cancel_url: `${baseUrl(req)}/my-games`,
      // Just over Stripe's 30-minute minimum, so an abandoned checkout clears quickly.
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      integration_identifier: CHECKOUT_LABELS.launch,
    });
    db.prepare("UPDATE orders SET stripe_session_id = ? WHERE id = ?").run(session.id, orderId);
    db.prepare("UPDATE games SET order_id = ?, cancel_at_period_end = 0, period_end = NULL WHERE id = ?").run(orderId, g.id);
    res.json({ url: session.url, orderId });
  } catch (e) {
    if (orderId) db.prepare("DELETE FROM orders WHERE id = ?").run(orderId);
    console.error("Launch checkout failed", e.message);
    res.status(502).json({ error: "Checkout couldn't start. Try again in a moment." });
  }
}));

// Cancel: Stripe stops renewing at the end of the paid month. The game stays up until
// then and that month isn't refunded.
// Suspended creators can still stop paying for a game that's been taken off the games page.
gamesRouter.post("/:id(\\d+)/cancel", requireUserOrSuspended, rateLimit({ windowMs: 60_000, max: 10 }), handle(async (req, res) => {
  const g = ownGame(req);
  if (!g) return notYours(res);
  if (!PAID.includes(g.o_status) || !["active", "past_due", "paused"].includes(g.o_sub_status)) {
    return res.status(409).json({ error: "This game isn't launched, so there's nothing to cancel." });
  }
  if (g.cancel_at_period_end) return res.json({ game: ownerGame(g) });
  if (!g.o_sub_id) return res.status(409).json({ error: "Your launch is still being set up. Try again in a minute." });
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: "Payments aren't set up yet." });
  try {
    syncLaunchSubscription(await stripe.subscriptions.update(g.o_sub_id, { cancel_at_period_end: true }), g.order_id);
  } catch (e) {
    console.error("Launch cancel failed", e.message);
    return res.status(502).json({ error: "The launch couldn't be canceled right now. Try again in a moment." });
  }
  res.json({ game: ownerGame(getGame(g.id)) });
}));

// Undo a cancel before the paid month ends.
gamesRouter.post("/:id(\\d+)/resume", requireUser, rateLimit({ windowMs: 60_000, max: 10 }), handle(async (req, res) => {
  const g = ownGame(req);
  if (!g) return notYours(res);
  const ended = "This launch has already ended. Launch the game again to put it back.";
  if (!g.cancel_at_period_end || !g.o_sub_id || !PAID.includes(g.o_status) || g.o_sub_status === "canceled") {
    return res.status(409).json({ error: g.o_sub_status === "canceled" ? ended : "This launch isn't set to end." });
  }
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: "Payments aren't set up yet." });
  try {
    // A cancel made in the billing portal may set an end date rather than the period flag.
    const sub = await stripe.subscriptions.retrieve(g.o_sub_id);
    if (sub.status === "canceled") return res.status(409).json({ error: ended });
    const change = sub.cancel_at_period_end ? { cancel_at_period_end: false } : { cancel_at: "" };
    syncLaunchSubscription(await stripe.subscriptions.update(g.o_sub_id, change), g.order_id);
  } catch (e) {
    console.error("Launch resume failed", e.message);
    return res.status(502).json({ error: "The launch couldn't be switched back on right now. Try again in a moment." });
  }
  res.json({ game: ownerGame(getGame(g.id)) });
}));

// ---------- Site owner routes ----------
export const adminGamesRouter = express.Router();

adminGamesRouter.get("/games", requireUser, requireAdmin, (_req, res) => {
  const rows = db.prepare(`${SELECT} WHERE g.order_id IS NOT NULL OR g.hidden = 1 ORDER BY g.id DESC LIMIT 200`).all();
  res.json({ games: rows.map(g => ({ ...adminGame(g), orderId: g.order_id })) });
});

// Take a game down (or put it back), and mark it 18+ if its creator didn't.
adminGamesRouter.patch("/games/:id(\\d+)", requireUser, requireAdmin, (req, res) => {
  const { hidden, adultOnly } = req.body ?? {};
  if (hidden !== undefined && typeof hidden !== "boolean") return res.status(400).json({ error: "hidden must be true or false." });
  if (adultOnly !== undefined && typeof adultOnly !== "boolean") return res.status(400).json({ error: "adultOnly must be true or false." });
  const flag = adultOnly === undefined ? null : adultOnly ? 1 : 0;
  const r = db.prepare(`UPDATE games SET hidden = COALESCE(?, hidden), adult_only = COALESCE(?, adult_only),
    adult_forced = COALESCE(?, adult_forced) WHERE id = ?`)
    .run(hidden === undefined ? null : hidden ? 1 : 0, flag, flag, Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: "Game not found." });
  res.json({ game: adminGame(getGame(req.params.id)) });
});

// People can report a game on the games page; the owner can take it down from the reports queue.
const gameId = id => /^[1-9][0-9]{0,15}$/.test(id) ? Number(id) : null;
registerReportTarget("game", {
  exists: id => gameId(id) !== null && !!db.prepare(`SELECT 1 FROM games g WHERE g.id = ? AND ${LIVE}`).get(gameId(id)),
  describe: id => {
    const g = gameId(id) && db.prepare("SELECT id, title, user_id, hidden FROM games WHERE id = ?").get(gameId(id));
    return g && { title: g.title, url: `/game?id=${g.id}`, ownerUserId: g.user_id, state: g.hidden ? "hidden" : "visible" };
  },
  hide: id => gameId(id) !== null && db.prepare("UPDATE games SET hidden = 1 WHERE id = ?").run(gameId(id)).changes > 0,
});
