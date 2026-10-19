// Messages between people: an inbox with one thread per person. Anyone can block
// someone, after which neither can message the other. A light automatic filter
// stops the most common scams (sending people off-site to pay, or asking for
// passwords) before they're delivered; everything else can be reported.
import express from "express";
import { db, now } from "./db.js";
import { requireUser } from "./auth.js";
import { rateLimit } from "./limit.js";

export const MAX_LENGTH = 2000;
const SCAM = [
  /\b(pass(word)?|2fa|verification code|login code|seed phrase)\b.{0,40}\b(send|give|tell|share)\b|\b(send|give|tell|share)\b.{0,40}\b(pass(word)?|2fa|verification code|login code|seed phrase)\b/i,
  /\b(gift ?cards?|crypto|bitcoin|usdt|cash ?app|western union)\b.{0,60}\b(pay|send|instead)\b|\b(pay|send)\b.{0,60}\b(gift ?cards?|bitcoin|usdt|western union)\b/i,
  /\bfree (robux|v-?bucks|nitro)\b/i,
];
export const looksLikeScam = text => SCAM.some(r => r.test(text));

const person = name => db.prepare("SELECT id, username, name, picture, suspended_at FROM users WHERE username = ?").get(String(name).toLowerCase());
const blocked = (a, b) => !!db.prepare("SELECT 1 FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)").get(a, b, b, a);

export const messagesRouter = express.Router();
messagesRouter.use(requireUser);

// One row per person you've talked with, newest first, with unread counts.
messagesRouter.get("/", (req, res) => {
  const me = req.user.id;
  const rows = db.prepare(`SELECT other, MAX(id) AS last_id, SUM(unread) AS unread FROM (
      SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS other, id,
        CASE WHEN to_id = ? AND read_at IS NULL THEN 1 ELSE 0 END AS unread
      FROM messages WHERE from_id = ? OR to_id = ?) GROUP BY other ORDER BY last_id DESC LIMIT 100`).all(me, me, me, me);
  const threads = rows.map(r => {
    const u = db.prepare("SELECT username, name, picture FROM users WHERE id = ?").get(r.other);
    const last = db.prepare("SELECT body, from_id, created_at FROM messages WHERE id = ?").get(r.last_id);
    return u && { username: u.username, name: u.name, picture: u.picture, unread: r.unread, last: last.body.slice(0, 120), lastFromMe: last.from_id === me, at: last.created_at };
  }).filter(Boolean);
  res.json({ threads, unread: threads.reduce((n, t) => n + t.unread, 0) });
});

messagesRouter.get("/unread", (req, res) => {
  res.json({ unread: db.prepare("SELECT COUNT(*) AS n FROM messages WHERE to_id = ? AND read_at IS NULL").get(req.user.id).n });
});

messagesRouter.get("/:username", (req, res) => {
  const other = person(req.params.username);
  if (!other || other.id === req.user.id) return res.status(404).json({ error: "No one has that username." });
  const me = req.user.id;
  const msgs = db.prepare(`SELECT id, from_id, body, created_at FROM messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
    ORDER BY id DESC LIMIT 200`).all(me, other.id, other.id, me).reverse();
  db.prepare("UPDATE messages SET read_at = ? WHERE from_id = ? AND to_id = ? AND read_at IS NULL").run(now(), other.id, me);
  res.json({
    with: { username: other.username, name: other.name, picture: other.picture },
    blockedByMe: !!db.prepare("SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?").get(me, other.id),
    canSend: !other.suspended_at && !blocked(me, other.id),
    messages: msgs.map(m => ({ id: m.id, mine: m.from_id === me, body: m.body, at: m.created_at })),
  });
});

messagesRouter.post("/:username", rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  const other = person(req.params.username);
  if (!other || other.id === req.user.id || other.suspended_at) return res.status(404).json({ error: "You can't message that person." });
  if (blocked(req.user.id, other.id)) return res.status(403).json({ error: "You can't message this person." });
  const body = String(req.body?.body ?? "").trim();
  if (!body) return res.status(400).json({ error: "Write a message first." });
  if (body.length > MAX_LENGTH) return res.status(400).json({ error: `Messages can be up to ${MAX_LENGTH} characters.` });
  if (looksLikeScam(body)) {
    return res.status(422).json({ error: "This message wasn't sent because it looks like a scam (asking for passwords or codes, or paying outside Forgehub). Keep payments on Forgehub, and never share passwords." });
  }
  // New conversations are limited, so one account can't spam hundreds of people.
  const fresh = !db.prepare("SELECT 1 FROM messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)").get(req.user.id, other.id, other.id, req.user.id);
  if (fresh && db.prepare(`SELECT COUNT(DISTINCT to_id) AS n FROM messages WHERE from_id = ? AND created_at > ?`).get(req.user.id, new Date(Date.now() - 86400000).toISOString()).n >= 30) {
    return res.status(429).json({ error: "You've started a lot of new conversations today. Try again tomorrow." });
  }
  const m = db.prepare("INSERT INTO messages (from_id, to_id, body, created_at) VALUES (?, ?, ?, ?) RETURNING id, created_at").get(req.user.id, other.id, body, now());
  res.status(201).json({ message: { id: m.id, mine: true, body, at: m.created_at } });
});

messagesRouter.post("/:username/block", (req, res) => {
  const other = person(req.params.username);
  if (!other || other.id === req.user.id) return res.status(404).json({ error: "No one has that username." });
  if (req.body?.block === false) db.prepare("DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?").run(req.user.id, other.id);
  else db.prepare("INSERT OR IGNORE INTO blocks (user_id, blocked_id) VALUES (?, ?)").run(req.user.id, other.id);
  res.json({ blocked: req.body?.block !== false });
});
