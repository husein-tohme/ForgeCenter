// Sign in with GitHub, Microsoft and Discord (OAuth 2.0 authorization code flow).
// Each provider turns on when its CLIENT_ID and CLIENT_SECRET are set.
import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db.js";
import { hash, parseCookies, signInWith, startSession, LinkError } from "./auth.js";
import { rateLimit } from "./limit.js";

const NONCE_COOKIE = "fh_oauth";
const STATE_TTL_MS = 10 * 60_000;
const USER_AGENT = "Forgehub";
// Microsoft personal accounts (Outlook, Hotmail, Xbox) live in this tenant and
// always have verified emails. Work and school tenants can set any email, so
// those are never trusted for matching accounts.
const MICROSOFT_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

async function getJson(url, headers) {
  const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...headers } });
  if (!r.ok) throw new Error(`${new URL(url).hostname} returned ${r.status}`);
  return r.json();
}

function decodeJwtPayload(jwt) {
  const part = String(jwt).split(".")[1];
  if (!part) throw new Error("Missing ID token.");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

export const PROVIDERS = {
  github: {
    env: "GITHUB",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    pkce: true,
    async profile({ access_token }) {
      const auth = { Authorization: `Bearer ${access_token}` };
      const u = await getJson("https://api.github.com/user", auth);
      const emails = await getJson("https://api.github.com/user/emails", auth).catch(() => []);
      const verified = emails.find(e => e.primary && e.verified) ?? emails.find(e => e.verified);
      return { subject: String(u.id), name: u.name || u.login, picture: u.avatar_url,
        email: verified?.email ?? null, emailVerified: !!verified, display: `@${u.login}` };
    },
  },
  microsoft: {
    env: "MICROSOFT",
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "openid profile email",
    pkce: true,
    // The ID token comes straight from Microsoft's token endpoint over TLS, using our
    // client secret, so it's trusted without a separate signature check (OIDC Core 3.1.3.7).
    async profile({ id_token }) {
      const c = decodeJwtPayload(id_token);
      if (c.aud !== process.env.MICROSOFT_CLIENT_ID || !c.sub) throw new Error("Unexpected Microsoft ID token.");
      const personal = c.tid === MICROSOFT_CONSUMER_TENANT;
      const email = c.email || c.preferred_username || null;
      return { subject: `${c.tid}:${c.sub}`, name: c.name || "Microsoft user", picture: null,
        email: personal ? email : null, emailVerified: personal && !!email, display: email };
    },
  },
  discord: {
    env: "DISCORD",
    authorizeUrl: "https://discord.com/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    scope: "identify email",
    pkce: false,
    async profile({ access_token }) {
      const u = await getJson("https://discord.com/api/users/@me", { Authorization: `Bearer ${access_token}` });
      return { subject: u.id, name: u.global_name || u.username,
        picture: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : null,
        email: u.verified ? u.email : null, emailVerified: !!(u.verified && u.email), display: `@${u.username}` };
    },
  },
};

const credentials = p => ({ id: process.env[`${p.env}_CLIENT_ID`], secret: process.env[`${p.env}_CLIENT_SECRET`] });
export const enabledOAuthProviders = () => Object.keys(PROVIDERS).filter(k => {
  const c = credentials(PROVIDERS[k]);
  return c.id && c.secret;
});

const baseUrl = req => process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
const redirectUri = (req, provider) => `${baseUrl(req)}/api/auth/${provider}/callback`;
const safeReturn = path => (typeof path === "string" && /^\/(?![/\\])[^\s]*$/.test(path) ? path.slice(0, 300) : "/");
const withParam = (path, key, value) => `${path.split("#")[0]}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}${path.includes("#") ? `#${path.split("#")[1]}` : ""}`;

export const oauthRouter = express.Router();

// Step 1: send the person to the provider.
oauthRouter.get("/:provider/start", rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  const name = req.params.provider;
  const provider = PROVIDERS[name];
  if (!provider || !enabledOAuthProviders().includes(name)) return res.status(404).json({ error: "That sign-in option isn't available." });
  const returnTo = safeReturn(req.query.return);
  const linking = req.query.link === "1" && req.user;

  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  db.prepare("DELETE FROM oauth_states WHERE expires_at < ?").run(Date.now());
  db.prepare(`INSERT INTO oauth_states (state_hash, provider, verifier, nonce_hash, link_user_id, return_to, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(hash(state), name, verifier, hash(nonce), linking ? req.user.id : null, returnTo, Date.now() + STATE_TTL_MS);

  // Ties the callback to this browser so nobody can sign you in to their account.
  res.cookie(NONCE_COOKIE, nonce, { httpOnly: true, sameSite: "lax", path: "/api/auth", maxAge: STATE_TTL_MS, secure: process.env.NODE_ENV === "production" });

  const url = new URL(provider.authorizeUrl);
  url.search = new URLSearchParams({
    client_id: credentials(provider).id, redirect_uri: redirectUri(req, name), response_type: "code",
    scope: provider.scope, state,
    ...(provider.pkce ? { code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" } : {}),
    ...(name === "microsoft" ? { prompt: "select_account" } : {}),
  });
  res.redirect(302, url.toString());
});

// Step 2: the provider sends the person back here with a one-time code.
oauthRouter.get("/:provider/callback", rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  const name = req.params.provider;
  const provider = PROVIDERS[name];
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const row = state && db.prepare("SELECT * FROM oauth_states WHERE state_hash = ?").get(hash(state));
  if (row) db.prepare("DELETE FROM oauth_states WHERE state_hash = ?").run(row.state_hash); // single use
  res.clearCookie(NONCE_COOKIE, { path: "/api/auth" });
  const back = (key) => res.redirect(303, withParam(row?.return_to || "/", "auth_error", key));

  const nonce = parseCookies(req.headers.cookie)[NONCE_COOKIE];
  if (!provider || !row || row.provider !== name || row.expires_at < Date.now() || !nonce || hash(nonce) !== row.nonce_hash) {
    return back("expired");
  }
  if (req.query.error || typeof req.query.code !== "string") return back("denied");
  if (row.link_user_id && req.user?.id !== row.link_user_id) return back("expired");

  let profile;
  try {
    const { id, secret } = credentials(provider);
    const r = await fetch(provider.tokenUrl, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
      body: new URLSearchParams({
        grant_type: "authorization_code", code: req.query.code, redirect_uri: redirectUri(req, name),
        client_id: id, client_secret: secret, ...(provider.pkce ? { code_verifier: row.verifier } : {}),
      }),
    });
    const token = await r.json().catch(() => ({}));
    if (!r.ok || token.error || !(token.access_token || token.id_token)) throw new Error(token.error_description || token.error || `token ${r.status}`);
    profile = { provider: name, ...(await provider.profile(token)) };
  } catch (e) {
    console.error(`${name} sign-in failed`, e.message);
    return back("failed");
  }

  try {
    const user = signInWith(profile, row.link_user_id);
    startSession(res, user.id);
    res.redirect(303, row.link_user_id ? withParam(row.return_to, "connected", name) : row.return_to);
  } catch (e) {
    if (e instanceof LinkError) return back(e.message.includes("already has") ? "already_connected" : "linked_elsewhere");
    throw e;
  }
});
