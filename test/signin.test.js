import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { api, signIn, url } from "./helpers.js";
import { setWhatsAppTransport } from "../src/whatsapp.js";

for (const p of ["GITHUB", "MICROSOFT", "DISCORD"]) {
  process.env[`${p}_CLIENT_ID`] = `${p.toLowerCase()}-client`;
  process.env[`${p}_CLIENT_SECRET`] = `${p.toLowerCase()}-secret`;
}
Object.assign(process.env, { WHATSAPP_TOKEN: "wa-token", WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_TEMPLATE: "login_code" });

// ---------- Simulated providers ----------
const realFetch = globalThis.fetch;
let accounts; // what each simulated provider returns
let tokenRequests;
const jwt = claims => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const json = data => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });

beforeEach(() => {
  tokenRequests = [];
  accounts = {
    github: { user: { id: 101, login: "steve", name: "Steve", avatar_url: "https://avatars.githubusercontent.com/u/101" },
      emails: [{ email: "steve@example.com", primary: true, verified: true }] },
    discord: { id: "202", username: "alex", global_name: "Alex", avatar: null, email: "alex@example.com", verified: true },
    microsoft: { aud: "microsoft-client", sub: "ms-303", tid: "9188040d-6c67-4c5b-b112-36a304b66dad", name: "Sam", email: "sam@outlook.com" },
  };
  globalThis.fetch = async (input, init) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    if (u.hostname === "127.0.0.1") return realFetch(input, init);
    if (u.pathname.endsWith("/token") || u.pathname === "/login/oauth/access_token") {
      tokenRequests.push({ host: u.hostname, body: Object.fromEntries(new URLSearchParams(String(init.body))) });
      return json(u.hostname.includes("microsoft") ? { id_token: jwt(accounts.microsoft), access_token: "ms" } : { access_token: "tok" });
    }
    if (u.href === "https://api.github.com/user") return json(accounts.github.user);
    if (u.href === "https://api.github.com/user/emails") return json(accounts.github.emails);
    if (u.href === "https://discord.com/api/users/@me") return json(accounts.discord);
    return new Response("nope", { status: 404 });
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const cookieFrom = (r, name) => r.headers.getSetCookie().map(c => c.split(";")[0]).find(c => c.startsWith(`${name}=`));

// Runs the whole redirect dance in one go, like a browser would.
async function oauth(provider, { cookie = "", ret = "/account", link = false, query = null, keepNonce = true } = {}) {
  const start = await realFetch(url(`/api/auth/${provider}/start?return=${encodeURIComponent(ret)}${link ? "&link=1" : ""}`),
    { redirect: "manual", headers: cookie ? { cookie } : {} });
  assert.equal(start.status, 302);
  const location = new URL(start.headers.get("location"));
  const nonce = cookieFrom(start, "fc_oauth");
  const params = query ?? `code=abc&state=${location.searchParams.get("state")}`;
  const cb = await realFetch(url(`/api/auth/${provider}/callback?${params}`), {
    redirect: "manual", headers: { cookie: [cookie, keepNonce ? nonce : ""].filter(Boolean).join("; ") },
  });
  return { start: location, state: location.searchParams.get("state"), nonce, status: cb.status,
    location: cb.headers.get("location"), session: cookieFrom(cb, "fc_session") };
}

// ---------- OAuth providers ----------
test("enabled sign-in options are listed", async () => {
  const { signIn: options } = (await api("/api/config")).body;
  assert.deepEqual(options, ["google", "github", "microsoft", "discord", "whatsapp"]);
});

test("GitHub sign-in uses state and PKCE, then signs the person in", async () => {
  const r = await oauth("github");
  assert.equal(r.start.origin + r.start.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(r.start.searchParams.get("code_challenge_method"), "S256");
  assert.ok(r.start.searchParams.get("code_challenge"));
  assert.equal(r.status, 303);
  assert.equal(r.location, "/account");
  assert.ok(tokenRequests[0].body.code_verifier, "token exchange sends the PKCE verifier");
  assert.equal(tokenRequests[0].body.client_secret, "github-secret");
  const me = (await api("/api/me", { cookie: r.session })).body.user;
  assert.equal(me.email, "steve@example.com");
  assert.equal(me.name, "Steve");
});

test("sign-in links can't be replayed or used from another browser", async () => {
  const first = await oauth("github");
  const replay = await realFetch(url(`/api/auth/github/callback?code=abc&state=${first.state}`), { redirect: "manual", headers: { cookie: first.nonce } });
  assert.match(replay.headers.get("location"), /auth_error=expired/);

  const noCookie = await oauth("github", { keepNonce: false });
  assert.match(noCookie.location, /auth_error=expired/);
  assert.equal(noCookie.session, undefined);
});

test("cancelling at the provider and bad return paths are handled", async () => {
  const denied = await oauth("discord", { query: "error=access_denied&state=PLACEHOLDER" });
  assert.match(denied.location, /auth_error=expired/); // unknown state
  const start = await realFetch(url("/api/auth/discord/start?return=/textures"), { redirect: "manual" });
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  const cb = await realFetch(url(`/api/auth/discord/callback?error=access_denied&state=${state}`), { redirect: "manual", headers: { cookie: cookieFrom(start, "fc_oauth") } });
  assert.equal(cb.headers.get("location"), "/textures?auth_error=denied");

  const evil = await oauth("discord", { ret: "//evil.example/steal" });
  assert.equal(evil.location, "/");
});

test("a verified email joins the existing account instead of making a second one", async () => {
  const google = signIn("steve@example.com");
  const r = await oauth("github");
  const me = (await api("/api/me", { cookie: r.session })).body.user;
  assert.equal(me.id, google.user.id);
  const ids = (await api("/api/me/identities", { cookie: r.session })).body.identities.map(i => i.provider);
  assert.deepEqual(ids.sort(), ["github", "google"]);
});

test("unverified emails are never trusted", async () => {
  signIn("victim@example.com");
  accounts.github.emails = [{ email: "victim@example.com", primary: true, verified: false }];
  accounts.github.user.id = 999;
  const gh = (await api("/api/me", { cookie: (await oauth("github")).session })).body.user;
  assert.equal(gh.email, null);

  accounts.discord = { ...accounts.discord, id: "998", email: "victim@example.com", verified: false };
  const dc = (await api("/api/me", { cookie: (await oauth("discord")).session })).body.user;
  assert.equal(dc.email, null);
});

test("a Microsoft work account can't claim the owner's email", async () => {
  accounts.microsoft = { aud: "microsoft-client", sub: "attacker", tid: "some-company-tenant", name: "Mallory", email: "owner@example.com" };
  const r = await oauth("microsoft");
  const me = (await api("/api/me", { cookie: r.session })).body.user;
  assert.equal(me.email, null);
  assert.equal(me.isAdmin, false);
  assert.equal((await api("/api/admin/orders", { cookie: r.session })).status, 403);
});

test("a personal Microsoft account signs in with its email", async () => {
  const r = await oauth("microsoft");
  assert.equal((await api("/api/me", { cookie: r.session })).body.user.email, "sam@outlook.com");
});

test("signed-in people can connect and disconnect sign-in methods", async () => {
  const me = signIn("linker@example.com");
  accounts.discord = { ...accounts.discord, id: "777", email: "different@example.com" };
  const r = await oauth("discord", { cookie: me.cookie, link: true });
  assert.equal(r.location, "/account?connected=discord");
  let ids = (await api("/api/me/identities", { cookie: me.cookie })).body.identities;
  assert.deepEqual(ids.map(i => i.provider).sort(), ["discord", "google"]);

  // Someone else can't take that Discord account.
  const other = signIn("other@example.com");
  const steal = await oauth("discord", { cookie: other.cookie, link: true });
  assert.match(steal.location, /auth_error=linked_elsewhere/);

  assert.equal((await api("/api/me/identities/google", { method: "DELETE", body: {}, cookie: me.cookie })).status, 200);
  const last = await api("/api/me/identities/discord", { method: "DELETE", body: {}, cookie: me.cookie });
  assert.equal(last.status, 409);
});

test("people can change their display name", async () => {
  const { cookie } = signIn("rename@example.com");
  const r = await api("/api/me", { method: "PATCH", body: { name: "  Builder Bob  " }, cookie });
  assert.equal(r.body.user.name, "Builder Bob");
  assert.equal((await api("/api/me", { method: "PATCH", body: { name: " " }, cookie })).status, 400);
});

// ---------- WhatsApp ----------
test("WhatsApp sign-in sends a code and signs in with the right one", async () => {
  const sent = [];
  setWhatsAppTransport(async m => sent.push(m));
  assert.equal((await api("/api/auth/whatsapp/start", { method: "POST", body: { phone: "07700 900123" } })).status, 400);

  assert.equal((await api("/api/auth/whatsapp/start", { method: "POST", body: { phone: "+44 7700 900123" } })).status, 200);
  assert.equal(sent[0].to, "447700900123");
  assert.match(sent[0].code, /^\d{6}$/);
  const wrong = sent[0].code === "000000" ? "111111" : "000000";
  assert.equal((await api("/api/auth/whatsapp/verify", { method: "POST", body: { phone: "+447700900123", code: wrong } })).status, 400);

  const ok = await realFetch(url("/api/auth/whatsapp/verify"), { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "+44 7700 900123", code: sent[0].code }) });
  const body = await ok.json();
  assert.equal(body.user.phone, "+447700900123");
  assert.equal(body.user.email, null);
  assert.equal(body.user.name, "Player 0123");
  // Codes work once.
  assert.equal((await api("/api/auth/whatsapp/verify", { method: "POST", body: { phone: "+447700900123", code: sent[0].code } })).status, 400);
});

test("WhatsApp codes lock after 5 wrong tries and sends are limited", async () => {
  const sent = [];
  setWhatsAppTransport(async m => sent.push(m));
  const phone = "+15555550100";
  await api("/api/auth/whatsapp/start", { method: "POST", body: { phone } });
  const wrong = sent[0].code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) await api("/api/auth/whatsapp/verify", { method: "POST", body: { phone, code: wrong } });
  const locked = await api("/api/auth/whatsapp/verify", { method: "POST", body: { phone, code: sent[0].code } });
  assert.equal(locked.status, 429);

  await api("/api/auth/whatsapp/start", { method: "POST", body: { phone } });
  await api("/api/auth/whatsapp/start", { method: "POST", body: { phone } });
  const limited = await api("/api/auth/whatsapp/start", { method: "POST", body: { phone } });
  assert.equal(limited.status, 429);
});

// ---------- Upgrading an existing database ----------
test("databases from the Google-only version are upgraded in place", () => {
  const file = join(mkdtempSync(join(tmpdir(), "fc-")), "old.db");
  const run = code => execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", code],
    { env: { ...process.env, DATABASE_PATH: file }, encoding: "utf8" });
  run(`import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(process.env.DATABASE_PATH);
    db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, google_sub TEXT NOT NULL UNIQUE, email TEXT NOT NULL, name TEXT NOT NULL, picture TEXT, stripe_customer_id TEXT, created_at TEXT NOT NULL)");
    db.exec("CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, product TEXT NOT NULL, amount INTEGER NOT NULL, monthly INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, subscription_status TEXT, stripe_session_id TEXT UNIQUE, stripe_subscription_id TEXT, brief TEXT NOT NULL DEFAULT '', deliverable_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
    db.exec("CREATE TABLE mods (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, modrinth_url TEXT, created_at TEXT NOT NULL)");
    db.exec("INSERT INTO users VALUES (7, 'g-7', 'old@example.com', 'Old Timer', null, 'cus_1', 'then')");
    db.exec("INSERT INTO orders (id, user_id, product, amount, status, created_at, updated_at) VALUES (1, 7, 'website', 100000, 'paid', 'then', 'then')");`);
  const out = JSON.parse(run(`const { db } = await import(${JSON.stringify(new URL("../src/db.js", import.meta.url).href)});
    console.log(JSON.stringify({
      user: db.prepare("SELECT id, email, phone, name, stripe_customer_id FROM users").get(),
      identity: db.prepare("SELECT provider, subject, user_id FROM identities").get(),
      order: db.prepare("SELECT user_id FROM orders WHERE id = 1").get(),
      fk: db.prepare("PRAGMA foreign_key_check").all().length,
      kind: db.prepare("PRAGMA table_info(mods)").all().some(c => c.name === "kind"),
    }));`));
  assert.deepEqual({ ...out.user }, { id: 7, email: "old@example.com", phone: null, name: "Old Timer", stripe_customer_id: "cus_1" });
  assert.deepEqual({ ...out.identity }, { provider: "google", subject: "g-7", user_id: 7 });
  assert.equal(out.order.user_id, 7);
  assert.equal(out.fk, 0);
  assert.equal(out.kind, true);
});
