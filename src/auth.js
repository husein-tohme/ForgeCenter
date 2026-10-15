// Google sign-in and sessions. Only real, verified Google accounts can sign in.
import express from "express";
import { OAuth2Client } from "google-auth-library";
import { createHash, randomBytes } from "node:crypto";
import { db, now } from "./db.js";
import { rateLimit } from "./limit.js";

const COOKIE = "fc_session";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const google = new OAuth2Client();
const hash = token => createHash("sha256").update(token).digest("hex");

const adminEmails = () => new Set((process.env.ADMIN_EMAILS || "")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
export const isAdmin = user => !!user && adminEmails().has(user.email.toLowerCase());

export const publicUser = u => u && ({
  id: u.id, email: u.email, name: u.name, picture: u.picture,
  isAdmin: isAdmin(u), hasBilling: !!u.stripe_customer_id,
});

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function upsertUser({ sub, email, name, picture }) {
  db.prepare(`INSERT INTO users (google_sub, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture`)
    .run(sub, email, name, picture ?? null, now());
  return db.prepare("SELECT * FROM users WHERE google_sub = ?").get(sub);
}

export function createSession(userId) {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(hash(token), userId, Date.now() + MAX_AGE_MS);
  return token;
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: MAX_AGE_MS,
    secure: process.env.NODE_ENV === "production",
  });
}

// Attaches req.user when the request carries a valid session cookie.
export function loadUser(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = db.prepare(`SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`).get(hash(token));
    if (row && row.expires_at > Date.now()) { req.user = row; req.sessionHash = hash(token); }
    else if (row) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash(token));
  }
  next();
}

export const requireUser = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: "Sign in with Google to continue." });

export const requireAdmin = (req, res, next) =>
  isAdmin(req.user) ? next() : res.status(403).json({ error: "Only the site owner can do this." });

export async function verifyGoogleCredential(credential) {
  const ticket = await google.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
  const p = ticket.getPayload();
  if (!p?.sub || !p.email) throw new Error("Google didn't return an account.");
  if (!p.email_verified) throw new Error("Verify your Google email address, then try again.");
  return { sub: p.sub, email: p.email, name: p.name || p.email.split("@")[0], picture: p.picture };
}

export const authRouter = express.Router();

authRouter.post("/google", rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: "Google sign-in isn't set up yet." });
  const credential = req.body?.credential;
  if (typeof credential !== "string") return res.status(400).json({ error: "Missing Google credential." });
  let profile;
  try { profile = await verifyGoogleCredential(credential); }
  catch (e) { return res.status(401).json({ error: e.message.startsWith("Verify") ? e.message : "Google sign-in failed. Try again." }); }
  const user = upsertUser(profile);
  setSessionCookie(res, createSession(user.id));
  res.json({ user: publicUser(user) });
});

authRouter.post("/logout", (req, res) => {
  if (req.sessionHash) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(req.sessionHash);
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

export const meRouter = express.Router();

meRouter.get("/", (req, res) => res.json({ user: publicUser(req.user) ?? null }));

meRouter.delete("/", requireUser, (req, res) => {
  const activeSubs = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE user_id = ?
    AND subscription_status IN ('active', 'past_due')`).get(req.user.id).n;
  if (activeSubs) return res.status(409).json({ error: "Cancel your subscriptions in Manage billing before deleting your account." });
  // Orders are kept for tax records, but without the person's name, brief or messages.
  db.prepare("DELETE FROM order_messages WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)").run(req.user.id);
  db.prepare("UPDATE orders SET brief = '' WHERE user_id = ?").run(req.user.id);
  db.prepare("DELETE FROM users WHERE id = ?").run(req.user.id);
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});
