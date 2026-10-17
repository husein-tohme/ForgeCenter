// One-click sign-in setup. GitHub can create the site's sign-in app from a manifest:
// the owner presses one button on GitHub, and GitHub hands the new app's keys back to
// this site, which stores them encrypted. Before anyone can sign in, the setup page is
// unlocked with a one-time code printed in the server log; after that, by the owner.
import express from "express";
import { randomBytes } from "node:crypto";
import { db, now } from "./db.js";
import { hash, isAdmin } from "./auth.js";
import { encrypt, decrypt, secretsEnabled } from "./secrets.js";
import { rateLimit } from "./limit.js";

db.exec(`CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_enc TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`);

// Settings saved by setup (sign-in app keys). Environment variables always win.
export function getSetting(key) {
  const row = db.prepare("SELECT value_enc FROM app_settings WHERE key = ?").get(key);
  if (!row || !secretsEnabled()) return null;
  try { return decrypt(row.value_enc); } catch { return null; }
}
export function setSetting(key, value) {
  db.prepare(`INSERT INTO app_settings (key, value_enc, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at`).run(key, encrypt(value), now());
}

// ---------- The one-time setup code ----------
let setupCodeHash = null;
// Printed at startup while nobody can sign in yet, so the owner can finish setup.
export function announceSetupCode(signInReady) {
  if (signInReady) { setupCodeHash = null; return; }
  const raw = randomBytes(5).toString("hex").toUpperCase();
  const code = `${raw.slice(0, 5)}-${raw.slice(5)}`;
  setupCodeHash = hash(code);
  const site = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  console.log(`Sign-in setup code: ${code}  (open ${site}/setup-signin and enter it)`);
}
export const setSetupCodeForTests = code => { setupCodeHash = code ? hash(code) : null; };

const allowed = (req, code) => isAdmin(req.user) || (!!setupCodeHash && typeof code === "string" && hash(code.trim().toUpperCase()) === setupCodeHash);

// Manifest states: single use, 15 minutes.
const states = new Map();
const STATE_TTL_MS = 15 * 60_000;

const siteUrl = req => (process.env.BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");

export function githubManifest(site) {
  return {
    // GitHub app names are unique across GitHub, so add a short random tag.
    name: `ForgeCenter ${randomBytes(3).toString("hex")}`,
    url: site,
    description: "Sign in to ForgeCenter with GitHub.",
    callback_urls: [`${site}/api/auth/github/callback`],
    redirect_url: `${site}/setup-signin/github/done`,
    hook_attributes: { url: site, active: false },
    public: true,
    request_oauth_on_install: false,
    // No extra permissions: GitHub rejected an email permission in the manifest, and
    // sign-in only needs the profile. Accounts from GitHub sign-in may have no email.
    default_events: [],
  };
}

export const setupRouter = express.Router();

setupRouter.get("/status", (req, res) => {
  res.json({
    needsCode: !isAdmin(req.user),
    codeActive: !!setupCodeHash,
    secrets: secretsEnabled(),
    github: !!(process.env.GITHUB_CLIENT_ID || getSetting("GITHUB_CLIENT_ID")),
    githubFromEnv: !!process.env.GITHUB_CLIENT_ID,
  });
});

// Returns where to post the manifest; the page submits it to GitHub as a form.
setupRouter.post("/github/start", rateLimit({ windowMs: 10 * 60_000, max: 10 }), (req, res) => {
  if (!allowed(req, req.body?.code)) return res.status(403).json({ error: "That setup code isn't right. Copy it again from the server log (Render: your service, then Logs)." });
  if (!secretsEnabled()) return res.status(503).json({ error: "SECRET_KEY isn't set, so the keys can't be stored safely. Add SECRET_KEY (32+ characters) and restart." });
  if (process.env.GITHUB_CLIENT_ID) return res.status(409).json({ error: "GitHub sign-in is already set up in the environment settings." });
  const state = randomBytes(24).toString("base64url");
  for (const [k, v] of states) if (v.expires < Date.now()) states.delete(k);
  states.set(hash(state), { expires: Date.now() + STATE_TTL_MS });
  res.json({ action: `https://github.com/settings/apps/new?state=${state}`, manifest: JSON.stringify(githubManifest(siteUrl(req))) });
});

// GitHub sends the owner back here with a one-time code for the new app's keys.
export async function githubDone(req, res) {
  const state = typeof req.query.state === "string" ? hash(req.query.state) : "";
  const entry = state && states.get(state);
  if (entry) states.delete(state);
  if (!entry || entry.expires < Date.now() || typeof req.query.code !== "string" || !/^[\w-]{1,100}$/.test(req.query.code)) {
    return res.redirect(303, "/setup-signin?github=expired");
  }
  try {
    const r = await fetch(`https://api.github.com/app-manifests/${req.query.code}/conversions`, {
      method: "POST", headers: { Accept: "application/vnd.github+json", "User-Agent": "ForgeCenter" },
    });
    const app = await r.json().catch(() => ({}));
    if (!r.ok || !app.client_id || !app.client_secret) throw new Error(app.message || `GitHub said ${r.status}`);
    setSetting("GITHUB_CLIENT_ID", app.client_id);
    setSetting("GITHUB_CLIENT_SECRET", app.client_secret);
    if (app.html_url) setSetting("GITHUB_APP_URL", app.html_url);
    setupCodeHash = null; // someone can sign in now; later changes need the owner
    res.redirect(303, "/setup-signin?github=on");
  } catch (e) {
    console.error("GitHub sign-in setup failed", e.message);
    res.redirect(303, "/setup-signin?github=failed");
  }
}
