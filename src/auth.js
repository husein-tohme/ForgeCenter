// Accounts, sessions and Google sign-in. Other providers live in oauth.js (GitHub,
// Microsoft, Discord) and whatsapp.js. Every account is backed by a real, verified
// identity from one of those providers; there are no passwords.
import express from "express";
import { OAuth2Client } from "google-auth-library";
import { createHash, randomBytes } from "node:crypto";
import { db, now } from "./db.js";
import { rateLimit } from "./limit.js";

const COOKIE = "fc_session";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const google = new OAuth2Client();
export const hash = value => createHash("sha256").update(value).digest("hex");

export const PROVIDER_NAMES = { google: "Google", github: "GitHub", microsoft: "Microsoft", discord: "Discord", whatsapp: "WhatsApp" };

const adminEmails = () => new Set((process.env.ADMIN_EMAILS || "")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
export const isAdmin = user => !!user?.email && adminEmails().has(user.email.toLowerCase());

export const publicUser = u => u && ({
  id: u.id, email: u.email, phone: u.phone, name: u.name, picture: u.picture,
  isAdmin: isAdmin(u), hasBilling: !!u.stripe_customer_id,
});

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch {}
    }
  }
  return out;
}

export class LinkError extends Error {}

// Finds or creates the account for a provider identity. With linkUserId, the identity
// is added to that (signed-in) account instead. Accounts are matched by email only when
// the provider verified it, so nobody can claim someone else's account (or the owner
// panel) with an unverified address.
export function signInWith({ provider, subject, email, emailVerified, name, picture, phone, display }, linkUserId = null) {
  const verifiedEmail = emailVerified && email ? email.toLowerCase() : null;
  const existing = db.prepare("SELECT * FROM identities WHERE provider = ? AND subject = ?").get(provider, subject);
  let userId;
  if (existing) {
    if (linkUserId && existing.user_id !== linkUserId) {
      throw new LinkError(`That ${PROVIDER_NAMES[provider]} account is already connected to a different ForgeCenter account.`);
    }
    userId = existing.user_id;
    db.prepare("UPDATE identities SET display = ? WHERE provider = ? AND subject = ?").run(display ?? null, provider, subject);
  } else {
    if (linkUserId && db.prepare("SELECT 1 FROM identities WHERE user_id = ? AND provider = ?").get(linkUserId, provider)) {
      throw new LinkError(`Your account already has a ${PROVIDER_NAMES[provider]} sign-in. Remove it first to connect a different one.`);
    }
    userId = linkUserId
      ?? (verifiedEmail && db.prepare("SELECT id FROM users WHERE lower(email) = ? ORDER BY id LIMIT 1").get(verifiedEmail)?.id)
      ?? Number(db.prepare("INSERT INTO users (email, phone, name, picture, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(verifiedEmail, phone ?? null, String(name || "Player").slice(0, 50), picture ?? null, now()).lastInsertRowid);
    db.prepare("INSERT INTO identities (provider, subject, user_id, display, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(provider, subject, userId, display ?? null, now());
  }
  // Fill in details the account doesn't have yet; never replace an email that's already set.
  db.prepare("UPDATE users SET email = COALESCE(email, ?), phone = COALESCE(phone, ?), picture = COALESCE(picture, ?) WHERE id = ?")
    .run(verifiedEmail, phone ?? null, picture ?? null, userId);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}

export function createSession(userId) {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(hash(token), userId, Date.now() + MAX_AGE_MS);
  return token;
}

export function startSession(res, userId) {
  res.cookie(COOKIE, createSession(userId), {
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
  req.user ? next() : res.status(401).json({ error: "Sign in to continue." });

export const requireAdmin = (req, res, next) =>
  isAdmin(req.user) ? next() : res.status(403).json({ error: "Only the site owner can do this." });

// ---------- Google ----------
export async function verifyGoogleCredential(credential) {
  const ticket = await google.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
  const p = ticket.getPayload();
  if (!p?.sub || !p.email) throw new Error("Google didn't return an account.");
  if (!p.email_verified) throw new Error("Verify your Google email address, then try again.");
  return { provider: "google", subject: p.sub, email: p.email, emailVerified: true,
    name: p.name || p.email.split("@")[0], picture: p.picture, display: p.email };
}

export const authRouter = express.Router();

authRouter.post("/google", rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: "Google sign-in isn't set up yet." });
  const credential = req.body?.credential;
  if (typeof credential !== "string") return res.status(400).json({ error: "Missing Google credential." });
  let profile;
  try { profile = await verifyGoogleCredential(credential); }
  catch (e) { return res.status(401).json({ error: e.message.startsWith("Verify") ? e.message : "Google sign-in failed. Try again." }); }
  let user;
  try { user = signInWith(profile, req.body?.link ? req.user?.id : null); }
  catch (e) { if (e instanceof LinkError) return res.status(409).json({ error: e.message }); throw e; }
  startSession(res, user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post("/logout", (req, res) => {
  if (req.sessionHash) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(req.sessionHash);
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

// ---------- The signed-in account ----------
export const meRouter = express.Router();

meRouter.get("/", (req, res) => res.json({ user: publicUser(req.user) ?? null }));

meRouter.patch("/", requireUser, (req, res) => {
  const name = String(req.body?.name ?? "").trim().slice(0, 50);
  if (!name) return res.status(400).json({ error: "Enter a name." });
  db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, req.user.id);
  res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id)) });
});

meRouter.get("/identities", requireUser, (req, res) => {
  res.json({ identities: db.prepare(`SELECT provider, display, created_at AS createdAt FROM identities
    WHERE user_id = ? ORDER BY created_at`).all(req.user.id) });
});

meRouter.delete("/identities/:provider", requireUser, (req, res) => {
  const count = db.prepare("SELECT COUNT(*) AS n FROM identities WHERE user_id = ?").get(req.user.id).n;
  if (count <= 1) return res.status(409).json({ error: "Connect another sign-in method before removing your last one." });
  const r = db.prepare("DELETE FROM identities WHERE user_id = ? AND provider = ?").run(req.user.id, req.params.provider);
  if (!r.changes) return res.status(404).json({ error: "That sign-in method isn't connected." });
  res.json({ ok: true });
});

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
