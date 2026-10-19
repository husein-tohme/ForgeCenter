// Accounts, sessions and Google sign-in. Other providers live in oauth.js (GitHub,
// Microsoft, Discord) and whatsapp.js. Every account is backed by a real, verified
// identity from one of those providers; there are no passwords.
import express from "express";
import { OAuth2Client } from "google-auth-library";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db, now, walletBalance, claimedOwnerEmail } from "./db.js";
import { rateLimit } from "./limit.js";
import { panelUserId } from "./pterodactyl.js";
import { notify } from "./email.js";

const COOKIE = "fc_session";
// Stay signed in until you sign out: each visit pushes the expiry a year ahead, so
// only a year without visiting signs you out.
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
const google = new OAuth2Client();
export const hash = value => createHash("sha256").update(value).digest("hex");

export const PROVIDER_NAMES = { google: "Google", github: "GitHub", microsoft: "Microsoft", discord: "Discord", whatsapp: "WhatsApp" };

const adminEmails = () => new Set((process.env.ADMIN_EMAILS || "")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
export const isAdmin = user => !!user?.email && (adminEmails().has(user.email.toLowerCase())
  || db.prepare("SELECT 1 FROM site_owner WHERE user_id = ?").get(user.id) !== undefined);

// ---------- One-time owner claim ----------
// A fresh site with no owner prints a setup code to the server log (only the person
// running the server can read it). Whoever signs in with a verified email and enters
// it becomes the owner; after that the claim is closed for good. A bare "type your
// email" box would let any visitor take the site.
const ownerClaimOpen = () => !claimedOwnerEmail();
let setupCode = null;
export function ownerSetupCode() {
  if (!ownerClaimOpen()) return null;
  if (!setupCode) { const raw = randomBytes(6).toString("hex").toUpperCase(); setupCode = `${raw.slice(0, 6)}-${raw.slice(6)}`; }
  return setupCode;
}

export const publicUser = u => u && ({
  id: u.id, email: u.email, phone: u.phone, name: u.name, picture: u.picture,
  isAdmin: isAdmin(u), hasBilling: !!u.stripe_customer_id,
  ageGroup: isAdmin(u) && u.age_group !== "under13" ? "adult" : u.age_group, ageMethod: isAdmin(u) && u.age_group !== "adult" ? "owner" : u.age_method, ageConfirmedAt: u.age_confirmed_at,
  wallet: walletBalance(u.id), emailUpdates: !u.email_optout, accountType: u.account_type ?? "personal",
  suspended: u.suspended_at ? { at: u.suspended_at, reason: u.suspended_reason } : null,
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
export function loadUser(req, res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = db.prepare(`SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`).get(hash(token));
    if (row && row.expires_at > Date.now()) {
      req.user = row; req.sessionHash = hash(token);
      // Renew at most once a day, in the database and in the browser.
      if (row.expires_at - Date.now() < MAX_AGE_MS - RENEW_AFTER_MS) {
        db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").run(Date.now() + MAX_AGE_MS, req.sessionHash);
        res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: MAX_AGE_MS, secure: process.env.NODE_ENV === "production" });
      }
    }
    else if (row) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash(token));
  }
  next();
}

// Signed in, whatever the account's state. Only for managing the account itself.
export const requireSignedIn = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: "Sign in to continue." });

// Signed in and past the birthday question every new account answers first, like
// Discord's sign-up. Accounts of people under 13 can't be used.
function accountBlock(user) {
  if (!user) return [401, { error: "Sign in to continue." }];
  if (user.age_group === "under13") return [403, { error: "This account is closed because ForgeCenter is for people 13 and older.", needs: "closed" }];
  // Owners are treated as adults, so they're never asked.
  if (!user.age_group && !isAdmin(user)) return [403, { error: "Tell us your birthday first.", needs: "birthday" }];
  return null;
}
export function requireUser(req, res, next) {
  const block = accountBlock(req.user);
  if (block) return res.status(block[0]).json(block[1]);
  // Suspended by the site owner (reports.js). The reason is the one they wrote.
  if (req.user.suspended_at) return res.status(403).json({ needs: "suspended",
    error: `Your account is suspended: ${req.user.suspended_reason || "it broke the ForgeCenter rules"}. To appeal, open a support ticket on the Help page.` });
  next();
}
// Like requireUser, but lets suspended accounts through. Only the support ticket routes
// use it, so a suspended person can still appeal.
export function requireUserOrSuspended(req, res, next) {
  const block = accountBlock(req.user);
  if (block) return res.status(block[0]).json(block[1]);
  next();
}

// Adults whose age was confirmed by a credit card check or an ID scan.
// Owners (ADMIN_EMAILS) run the company, so they skip the age check. Their stored age
// group is never changed; they're just treated as adults while they're owners.
export const isAdult = user => user?.age_group === "adult" || isAdmin(user);
export function requireAdult(req, res, next) {
  if (isAdult(req.user)) return next();
  res.status(403).json({ error: "This is for adults. Confirm your age to continue.", needs: "adult" });
}

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

export const ACCOUNT_TYPES = ["personal", "student", "business"];

// ---------- The signed-in account ----------
export const meRouter = express.Router();

meRouter.get("/", (req, res) => res.json({ user: publicUser(req.user) ?? null }));

meRouter.patch("/", requireSignedIn, (req, res) => {
  if (req.body?.accountType !== undefined) {
    // Business accounts come under the data processing agreement (/dpa).
    if (!ACCOUNT_TYPES.includes(req.body.accountType)) return res.status(400).json({ error: "Choose personal, student or business." });
    db.prepare("UPDATE users SET account_type = ? WHERE id = ?").run(req.body.accountType, req.user.id);
  }
  if (typeof req.body?.emailUpdates === "boolean") {
    db.prepare("UPDATE users SET email_optout = ? WHERE id = ?").run(req.body.emailUpdates ? 0 : 1, req.user.id);
  }
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim().slice(0, 50);
    if (!name) return res.status(400).json({ error: "Enter a name." });
    db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, req.user.id);
  }
  res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id)) });
});

meRouter.get("/owner-claim", requireSignedIn, (req, res) => res.json({ open: ownerClaimOpen() }));

meRouter.post("/owner-claim", requireSignedIn, rateLimit({ windowMs: 60 * 60_000, max: 5 }), (req, res) => {
  if (!ownerClaimOpen()) return res.status(410).json({ error: "This site already has an owner." });
  if (!req.user.email) return res.status(400).json({ error: "Sign in with a method that has a verified email (Google, GitHub, Discord or Microsoft) first." });
  const given = Buffer.from(String(req.body?.code ?? "").trim().toUpperCase());
  const want = Buffer.from(ownerSetupCode());
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return res.status(403).json({ error: "That code isn't right. Copy it from the server log (on Render: your service, then Logs)." });
  }
  db.prepare("INSERT OR IGNORE INTO site_owner (id, user_id, claimed_at) VALUES (1, ?, ?)").run(req.user.id, now());
  setupCode = null;
  res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id)) });
});

meRouter.get("/identities", requireSignedIn, (req, res) => {
  res.json({ identities: db.prepare(`SELECT provider, display, created_at AS createdAt FROM identities
    WHERE user_id = ? ORDER BY created_at`).all(req.user.id) });
});

meRouter.delete("/identities/:provider", requireSignedIn, (req, res) => {
  const count = db.prepare("SELECT COUNT(*) AS n FROM identities WHERE user_id = ?").get(req.user.id).n;
  if (count <= 1) return res.status(409).json({ error: "Connect another sign-in method before removing your last one." });
  const r = db.prepare("DELETE FROM identities WHERE user_id = ? AND provider = ?").run(req.user.id, req.params.provider);
  if (!r.changes) return res.status(404).json({ error: "That sign-in method isn't connected." });
  res.json({ ok: true });
});

// Download everything stored about you (GDPR access and portability). Every table
// with a user_id column is included, so new features are covered automatically;
// secrets (encrypted tokens, key hashes) and file contents are left out.
const SECRET_COLUMN = /token|secret|hash|_enc$|^data$|^blob$/i;
meRouter.get("/export", requireSignedIn, rateLimit({ windowMs: 60 * 60_000, max: 5 }), (req, res) => {
  const out = { exportedAt: now(), account: publicUser(req.user) };
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  for (const { name } of tables) {
    const cols = db.prepare(`PRAGMA table_info("${name}")`).all().map(c => c.name);
    if (!cols.includes("user_id")) continue;
    const keep = cols.filter(c => !SECRET_COLUMN.test(c));
    const rows = db.prepare(`SELECT ${keep.map(c => `"${c}"`).join(", ")} FROM "${name}" WHERE user_id = ?`).all(req.user.id);
    if (rows.length) out[name] = rows;
  }
  res.set("Content-Disposition", `attachment; filename="forgecenter-data-${req.user.id}.json"`);
  res.json(out);
});

// Why an account can't be deleted right now, or null if it can.
function deleteBlocker(userId) {
  const activeSubs = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE user_id = ?
    AND subscription_status IN ('active', 'past_due')`).get(userId).n;
  if (activeSubs) return "Cancel your subscriptions in Manage billing before deleting your account.";
  const balance = walletBalance(userId);
  if (balance > 0) return `You have ${balance.toLocaleString("en-US")} orbs. Spend them, or open a support ticket to have unused orb packs refunded, before deleting your account.`;
  if (balance < 0) return `Your orb balance is ${(-balance).toLocaleString("en-US")} below zero because a top-up was refunded or disputed after it was spent. Buy orbs or open a support ticket before deleting your account.`;
  return null;
}

function deleteAccount(userId) {
  // If they ever had a Minecraft server, queue their game panel login to be locked.
  db.prepare(`INSERT OR IGNORE INTO panel_cleanups (external_id) SELECT ? WHERE EXISTS (
      SELECT 1 FROM services s JOIN orders o ON o.id = s.order_id
      WHERE o.user_id = ? AND s.kind = 'minecraft' AND s.panel_server_id IS NOT NULL)`)
    .run(panelUserId(userId), userId);
  // Orders and wallet records are kept for tax records, but without the person's
  // name, brief or messages. Tickets and age checks go with the account.
  db.prepare("DELETE FROM order_messages WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)").run(userId);
  db.prepare("UPDATE orders SET brief = '' WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
}

meRouter.delete("/", requireSignedIn, (req, res) => {
  // Deleting and signing in again would start a fresh, unsuspended account.
  if (req.user.suspended_at) return res.status(409).json({ error: "Your account is suspended, so it can't be deleted from here. Open a support ticket on the Help page and the team will help." });
  const blocker = deleteBlocker(req.user.id);
  if (blocker) return res.status(409).json({ error: blocker });
  deleteAccount(req.user.id);
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

// ---------- Birthday (age screen) ----------
// Asked once, right after the first sign-in, without hinting at the answer that
// passes. People 18 or older (by exact birthday) go straight to the adult group,
// marked with age_method 'birthday'; everyone 13 to 17 is a teen. A card check or an
// ID scan (age.js) can still confirm an adult later. Only the group is stored, never
// the birthday itself.
const AGE_BLOCK = "fc_age_block";
// Bump when the terms change in a way people should agree to again.
export const TERMS_VERSION = "2026-10-18";
const MIN_AGE = 13;
const ADULT_AGE = 18;

export function ageOn(today, year, month, day) {
  let age = today.getUTCFullYear() - year;
  if (today.getUTCMonth() + 1 < month || (today.getUTCMonth() + 1 === month && today.getUTCDate() < day)) age--;
  return age;
}

function validBirthday(year, month, day, today) {
  if (![year, month, day].every(Number.isInteger)) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && d.getUTCMonth() === month - 1 && d.getUTCDate() === day && d <= today;
}

meRouter.post("/birthday", requireSignedIn, rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
  if (req.user.age_group) return res.json({ user: publicUser(req.user) }); // answered already; it can't be changed
  // Someone under 13 was turned away in this browser recently, so don't let them try another date.
  if (parseCookies(req.headers.cookie)[AGE_BLOCK]) {
    return res.status(403).json({ error: "A new account can't be set up in this browser right now. Try again tomorrow.", needs: "blocked" });
  }
  const today = new Date();
  const { year, month, day } = req.body ?? {};
  if (!validBirthday(year, month, day, today)) return res.status(400).json({ error: "Choose your full date of birth." });
  if (req.body?.acceptTerms !== true) return res.status(400).json({ error: "Tick the box to agree to the terms of service and privacy policy." });

  if (ageOn(today, year, month, day) < MIN_AGE) {
    res.cookie(AGE_BLOCK, "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 24 * 60 * 60 * 1000, secure: process.env.NODE_ENV === "production" });
    res.clearCookie(COOKIE, { path: "/" });
    if (deleteBlocker(req.user.id)) {
      // Rare: an older account with paid subscriptions or credit. Close it and let the owner sort out refunds.
      db.prepare("UPDATE users SET age_group = 'under13' WHERE id = ?").run(req.user.id);
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(req.user.id);
      notify.underageAccount(req.user);
    } else {
      deleteAccount(req.user.id);
    }
    return res.status(403).json({ error: "ForgeCenter accounts are for people 13 and older, so this account wasn't kept. The free creator tools still work without an account.", needs: "closed" });
  }
  const adult = ageOn(today, year, month, day) >= ADULT_AGE;
  db.prepare(`UPDATE users SET age_group = ?, age_method = ?, age_confirmed_at = ?, terms_accepted_at = ?, terms_version = ?
    WHERE id = ? AND age_group IS NULL`)
    .run(adult ? "adult" : "teen", adult ? "birthday" : null, adult ? now() : null, now(), TERMS_VERSION, req.user.id);
  res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id)) });
});
