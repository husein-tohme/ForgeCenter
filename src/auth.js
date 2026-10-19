// Accounts and sessions. Every account comes from a provider that verified it
// (GitHub, Discord, Microsoft); there are no passwords to leak. Emails are stored
// only when the provider verified them, because ADMIN_EMAILS trusts them.
import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { db, now } from "./db.js";
import { rateLimit } from "./limit.js";

export const COOKIE = "fh_session";
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000; // renewed daily, so only a year away signs you out
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
export const TERMS_VERSION = "2026-10-19";
export const hash = v => createHash("sha256").update(v).digest("hex");

const adminEmails = () => new Set((process.env.ADMIN_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
export const isAdmin = u => !!u?.email && adminEmails().has(u.email.toLowerCase());
export const isAdult = u => u?.age_group === "adult" || isAdmin(u);

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const cookieOpts = () => ({ httpOnly: true, sameSite: "lax", path: "/", maxAge: MAX_AGE_MS, secure: process.env.NODE_ENV === "production" });

export function startSession(res, userId) {
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(hash(token), userId, Date.now() + MAX_AGE_MS);
  res.cookie(COOKIE, token, cookieOpts());
}

export function loadUser(req, res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return next();
  const row = db.prepare("SELECT s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?").get(hash(token));
  if (!row || row.expires_at < Date.now()) return next();
  const { expires_at, ...user } = row;
  req.user = user;
  if (expires_at - Date.now() < MAX_AGE_MS - RENEW_AFTER_MS) {
    db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").run(Date.now() + MAX_AGE_MS, hash(token));
    res.cookie(COOKIE, token, cookieOpts());
  }
  next();
}

export class LinkError extends Error {}

// Finds or creates the account for a verified identity. With linkUserId, adds the
// identity to that signed-in account instead.
export function signInWith(p, linkUserId = null) {
  const existing = db.prepare("SELECT user_id FROM identities WHERE provider = ? AND subject = ?").get(p.provider, p.subject);
  if (linkUserId) {
    if (existing && existing.user_id !== linkUserId) throw new LinkError("That sign-in is linked to another account.");
    db.prepare("INSERT OR IGNORE INTO identities (provider, subject, user_id, display) VALUES (?, ?, ?, ?)").run(p.provider, p.subject, linkUserId, p.display ?? null);
    return db.prepare("SELECT * FROM users WHERE id = ?").get(linkUserId);
  }
  if (existing) return db.prepare("SELECT * FROM users WHERE id = ?").get(existing.user_id);
  const email = p.emailVerified ? p.email?.toLowerCase() : null;
  // A verified email that already has an account joins it, so GitHub and Discord with
  // the same address end up as one person.
  const byEmail = email && db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  const user = byEmail ?? db.prepare("INSERT INTO users (name, email, picture, created_at) VALUES (?, ?, ?, ?) RETURNING *")
    .get(String(p.name || "New user").slice(0, 50), email, p.picture ?? null, now());
  db.prepare("INSERT INTO identities (provider, subject, user_id, display) VALUES (?, ?, ?, ?)").run(p.provider, p.subject, user.id, p.display ?? null);
  return user;
}

export const publicUser = u => u && ({
  id: u.id, username: u.username, name: u.name, email: u.email, picture: u.picture, bio: u.bio, website: u.website,
  ageGroup: isAdmin(u) && u.age_group !== "under13" ? "adult" : u.age_group, accountType: u.account_type,
  isAdmin: isAdmin(u), emailUpdates: !u.email_optout, canSell: !!u.stripe_charges_enabled, suspended: !!u.suspended_at,
});

// Signed in, past the birthday question and with a username.
function block(u) {
  if (!u) return [401, { error: "Sign in to continue." }];
  if (u.age_group === "under13") return [403, { error: "Forgehub is for people 13 and older.", needs: "closed" }];
  if (!u.age_group && !isAdmin(u)) return [403, { error: "Tell us your birthday first.", needs: "birthday" }];
  if (!u.username) return [403, { error: "Pick a username first.", needs: "username" }];
  if (u.suspended_at) return [403, { error: "Your account is suspended. Email support to appeal.", needs: "suspended" }];
  return null;
}
export const requireSignedIn = (req, res, next) => req.user ? next() : res.status(401).json({ error: "Sign in to continue." });
export function requireUser(req, res, next) {
  const b = block(req.user);
  return b ? res.status(b[0]).json(b[1]) : next();
}
export const requireAdmin = (req, res, next) => isAdmin(req.user) ? next() : res.status(403).json({ error: "Owners only." });

// ---------- Usernames ----------
export const USERNAME_RE = /^[a-z0-9][a-z0-9-]{0,37}[a-z0-9]$/;
// Names that are pages of the site, so /<username> can never hide one.
export const RESERVED = new Set(["about", "account", "admin", "ai", "api", "explore", "help", "library", "login", "logout",
  "new", "p", "pricing", "privacy", "repos", "search", "settings", "signin", "store", "support", "terms", "forgehub",
  "sitemap", "robots", "favicon", "css", "js", "img", "static", "owner", "staff", "official", "dpa", "rules", "cookies", "llms"]);
export function usernameProblem(name) {
  if (!USERNAME_RE.test(name)) return "Use 2 to 39 lowercase letters, numbers or hyphens, not starting or ending with a hyphen.";
  if (RESERVED.has(name) || name.includes("forgehub")) return "That name is reserved. Try another one.";
  return null;
}

export const meRouter = express.Router();

meRouter.get("/", (req, res) => res.json({ user: publicUser(req.user) ?? null }));

meRouter.post("/username", requireSignedIn, rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  const name = String(req.body?.username ?? "").trim().toLowerCase();
  const problem = usernameProblem(name);
  if (problem) return res.status(400).json({ error: problem });
  if (db.prepare("SELECT 1 FROM users WHERE username = ? AND id != ?").get(name, req.user.id)) return res.status(409).json({ error: "That username is taken." });
  db.prepare("UPDATE users SET username = ? WHERE id = ?").run(name, req.user.id);
  res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id)) });
});

const ACCOUNT_TYPES = ["personal", "student", "business"];
const okUrl = u => { try { return ["http:", "https:"].includes(new URL(u).protocol); } catch { return false; } };
meRouter.patch("/", requireSignedIn, (req, res) => {
  const b = req.body ?? {};
  const sets = {};
  if (typeof b.name === "string" && b.name.trim()) sets.name = b.name.trim().slice(0, 50);
  if (typeof b.bio === "string") sets.bio = b.bio.trim().slice(0, 300);
  if (typeof b.website === "string") {
    if (b.website && !okUrl(b.website)) return res.status(400).json({ error: "Websites start with http:// or https://." });
    sets.website = b.website.slice(0, 200) || null;
  }
  if (ACCOUNT_TYPES.includes(b.accountType)) sets.account_type = b.accountType;
  if (typeof b.emailUpdates === "boolean") sets.email_optout = b.emailUpdates ? 0 : 1;
  for (const [k, v] of Object.entries(sets)) db.prepare(`UPDATE users SET ${k} = ? WHERE id = ?`).run(v, req.user.id);
  res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id)) });
});

// ---------- Birthday: asked once, only the group is kept ----------
export function ageOn(today, y, m, d) {
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d)) age--;
  return age;
}
meRouter.post("/birthday", requireSignedIn, rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
  if (req.user.age_group) return res.json({ user: publicUser(req.user) });
  const { year, month, day, acceptTerms } = req.body ?? {};
  const today = new Date();
  const date = new Date(Date.UTC(year, month - 1, day));
  if (![year, month, day].every(Number.isInteger) || year < 1900 || date.getUTCMonth() !== month - 1 || date > today) {
    return res.status(400).json({ error: "Choose your full date of birth." });
  }
  if (acceptTerms !== true) return res.status(400).json({ error: "Tick the box to agree to the terms and privacy policy." });
  const age = ageOn(today, year, month, day);
  if (age < 13) {
    db.prepare("DELETE FROM users WHERE id = ?").run(req.user.id);
    res.clearCookie(COOKIE, { path: "/" });
    return res.status(403).json({ error: "Forgehub accounts are for people 13 and older, so this account wasn't kept.", needs: "closed" });
  }
  db.prepare("UPDATE users SET age_group = ?, terms_accepted_at = ? WHERE id = ? AND age_group IS NULL").run(age >= 18 ? "adult" : "teen", now(), req.user.id);
  res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id)) });
});

// ---------- Your data ----------
// Everything about you as JSON, minus secrets and file contents (download repos as zips).
const SECRET = /token|secret|hash|verifier|^data$/i;
meRouter.get("/export", requireSignedIn, rateLimit({ windowMs: 60 * 60_000, max: 5 }), (req, res) => {
  const out = { exportedAt: now() };
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(t => t.name);
  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
    const keep = cols.filter(c => !SECRET.test(c));
    const col = t === "users" ? "id" : ["user_id", "buyer_id", "reporter_id"].find(c => cols.includes(c));
    if (!col || !keep.length) continue;
    out[t] = db.prepare(`SELECT ${keep.map(c => `"${c}"`).join(", ")} FROM ${t} WHERE ${col} = ?`).all(req.user.id);
  }
  res.setHeader("Content-Disposition", 'attachment; filename="forgehub-data.json"');
  res.json(out);
});

meRouter.delete("/", requireSignedIn, (req, res) => {
  if (req.user.suspended_at) return res.status(409).json({ error: "Suspended accounts can't be deleted here. Email support." });
  // Purchases stay for tax records, without the person attached (ON DELETE SET NULL).
  db.prepare("DELETE FROM users WHERE id = ?").run(req.user.id);
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

export const authRouter = express.Router();
authRouter.post("/logout", (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash(token));
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});
// Local testing only: sign in as anyone. Never on in production.
if (process.env.DEV_LOGIN === "1" && process.env.NODE_ENV !== "production") {
  authRouter.post("/dev", (req, res) => {
    const name = String(req.body?.name || "dev").slice(0, 30);
    const user = signInWith({ provider: "dev", subject: name, name, email: `${name}@example.com`, emailVerified: true });
    startSession(res, user.id);
    res.json({ user: publicUser(user) });
  });
}
