import { test } from "node:test";
import assert from "node:assert/strict";
import { api, db, signIn } from "./helpers.js";
import { startSession } from "../src/auth.js";

function freshAccount(name) {
  const user = db.prepare("INSERT INTO users (name, email, created_at) VALUES (?, ?, ?) RETURNING *").get(name, `${name}@example.com`, new Date().toISOString());
  let cookie;
  startSession({ cookie: (_n, t) => { cookie = `fh_session=${t}`; } }, user.id);
  return { user, cookie };
}
const yearsAgo = n => { const d = new Date(); return { year: d.getUTCFullYear() - n, month: d.getUTCMonth() + 1, day: d.getUTCDate() }; };

test("new accounts give a birthday (only the group is kept), then pick a username", async () => {
  const { user, cookie } = freshAccount("newbie");
  assert.equal((await api("/api/repos", { method: "POST", cookie, body: { name: "x" } })).body.needs, "birthday");
  assert.equal((await api("/api/me/birthday", { method: "POST", cookie, body: yearsAgo(15) })).status, 400); // no terms tick
  const b = await api("/api/me/birthday", { method: "POST", cookie, body: { ...yearsAgo(15), acceptTerms: true } });
  assert.equal(b.body.user.ageGroup, "teen");
  assert.ok(!Object.keys(db.prepare("SELECT * FROM users WHERE id = ?").get(user.id)).some(k => /birth|dob/.test(k)));
  assert.equal((await api("/api/repos", { method: "POST", cookie, body: { name: "x" } })).body.needs, "username");
  for (const bad of ["a", "-x", "admin", "explore", "has space", "forgehub-team"]) {
    assert.equal((await api("/api/me/username", { method: "POST", cookie, body: { username: bad } })).status, 400, bad);
  }
  signIn("taken");
  assert.equal((await api("/api/me/username", { method: "POST", cookie, body: { username: "taken" } })).status, 409);
  assert.equal((await api("/api/me/username", { method: "POST", cookie, body: { username: "newbie" } })).status, 200);
  assert.equal((await api("/api/repos", { method: "POST", cookie, body: { name: "x" } })).status, 201);
});

test("18 and over are adults; under 13s aren't kept", async () => {
  const a = freshAccount("grown");
  assert.equal((await api("/api/me/birthday", { method: "POST", cookie: a.cookie, body: { ...yearsAgo(18), acceptTerms: true } })).body.user.ageGroup, "adult");
  const k = freshAccount("kid");
  assert.equal((await api("/api/me/birthday", { method: "POST", cookie: k.cookie, body: { ...yearsAgo(11), acceptTerms: true } })).status, 403);
  assert.equal(db.prepare("SELECT 1 FROM users WHERE id = ?").get(k.user.id), undefined);
});

test("profile edits validate links; export leaves out secrets", async () => {
  const { cookie } = signIn("editor");
  assert.equal((await api("/api/me", { method: "PATCH", cookie, body: { website: "javascript:alert(1)" } })).status, 400);
  const ok = await api("/api/me", { method: "PATCH", cookie, body: { bio: "Hi", website: "https://example.com", accountType: "student" } });
  assert.equal(ok.body.user.accountType, "student");
  const exp = await api("/api/me/export", { cookie });
  assert.equal(exp.body.users[0].bio, "Hi");
  assert.ok(exp.body.sessions.every(s => !("token_hash" in s)));
});

test("cross-site requests are blocked", async () => {
  const { cookie } = signIn("victim");
  assert.equal((await api("/api/me", { method: "PATCH", cookie, body: { bio: "x" }, origin: "https://evil.example" })).status, 403);
});

test("reports reach owners, and suspending hides an account's things", async () => {
  process.env.ADMIN_EMAILS = "boss@example.com";
  const boss = signIn("boss");
  const bad = signIn("baddie");
  const me = signIn("reporter");
  await api("/api/repos", { method: "POST", cookie: bad.cookie, body: { name: "scam" } });
  assert.equal((await api("/api/reports", { method: "POST", cookie: me.cookie, body: { type: "repo", target: "baddie/scam", reason: "scam" } })).status, 201);
  assert.equal((await api("/api/admin/reports", { cookie: me.cookie })).status, 403);
  assert.equal((await api("/api/admin/reports", { cookie: boss.cookie })).body.reports[0].target_id, "baddie/scam");
  assert.equal((await api("/api/admin/users/boss/suspend", { method: "POST", cookie: boss.cookie, body: {} })).status, 403);
  await api("/api/admin/users/baddie/suspend", { method: "POST", cookie: boss.cookie, body: {} });
  assert.equal((await api("/api/repos/baddie/scam")).status, 404);
  assert.equal((await api("/baddie")).status, 404);
  assert.equal((await api("/api/repos", { method: "POST", cookie: bad.cookie, body: { name: "again" } })).body.needs, "suspended");
  process.env.ADMIN_EMAILS = "";
});
