// How reports and suspensions reach the features built on top of them: creator pages,
// launched games, shared assistants and API keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { api, db, signIn } from "./helpers.js";

let n = 0;
const person = (age = "teen") => signIn(`moderated${++n}@example.com`, `moderated-${n}`, { age });
const owner = () => signIn("owner@example.com");
const suspend = async userId => {
  const r = await api(`/api/admin/users/${userId}/suspend`, { method: "POST", cookie: owner().cookie, body: { reason: "Testing" } });
  assert.equal(r.status, 200, r.body?.error);
};
const report = (cookie, type, id) => api("/api/reports", { method: "POST", cookie, body: { type, id, reason: "spam" } });

// A game that's live on the games page: a paid launch order with an active subscription.
function liveGame(userId, title = "Sky Wars") {
  const t = new Date().toISOString();
  const orderId = Number(db.prepare(`INSERT INTO orders (user_id, product, amount, status, subscription_status, created_at, updated_at)
    VALUES (?, 'launch', 100, 'delivered', 'active', ?, ?)`).run(userId, t, t).lastInsertRowid);
  return Number(db.prepare(`INSERT INTO games (user_id, title, platform, icon, accent, order_id, created_at, updated_at, launched_at)
    VALUES (?, ?, 'minecraft', 'gamepad', 'emerald', ?, ?, ?, ?)`).run(userId, title, orderId, t, t, t).lastInsertRowid);
}

async function sharedAssistant(cookie) {
  const made = await api("/api/assistants", { method: "POST", cookie, body: {
    name: "Spam Bot", avatar: "robot", greeting: "Hi", instructions: "Say hi.", knowledge: "" } });
  assert.equal(made.status, 201, made.body?.error);
  const id = made.body.assistant.id;
  const shared = await api(`/api/assistants/${id}/share`, { method: "POST", cookie, body: { shared: true } });
  assert.equal(shared.status, 200, shared.body?.error);
  return shared.body.assistant.shareToken;
}

test("creator pages, games and shared assistants can be reported and hidden from the queue", async () => {
  const maker = person(), reporter = person(), boss = owner();
  assert.equal((await api("/api/creators/mine", { method: "PUT", cookie: maker.cookie,
    body: { handle: "spammy-sam", bio: "", links: [], support: {} } })).status, 200);
  const gameId = liveGame(maker.user.id);
  const token = await sharedAssistant(maker.cookie);

  for (const [type, id] of [["creator", "spammy-sam"], ["game", String(gameId)], ["assistant", token]]) {
    assert.equal((await report(maker.cookie, type, id)).status, 400, `${type}: can't report your own`);
    assert.equal((await report(reporter.cookie, type, id)).status, 201, type);
  }
  assert.equal((await report(reporter.cookie, "game", "999999")).status, 404);

  const queue = (await api("/api/admin/reports", { cookie: boss.cookie })).body.reports;
  const byType = Object.fromEntries(queue.filter(r => r.target?.owner?.id === maker.user.id).map(r => [r.type, r]));
  assert.equal(byType.creator.target.url, "/c/spammy-sam");
  assert.equal(byType.game.target.url, `/game?id=${gameId}`);
  assert.equal(byType.assistant.target.url, `/assistant?t=${token}`);
  for (const r of Object.values(byType)) {
    assert.equal(r.canHide, true);
    const hidden = await api(`/api/admin/reports/${r.id}`, { method: "PATCH", cookie: boss.cookie, body: { status: "actioned", hide: true } });
    assert.equal(hidden.status, 200, hidden.body?.error);
  }
  assert.equal((await api("/api/creators/spammy-sam", { cookie: reporter.cookie })).status, 404);
  assert.ok(!(await api("/api/games")).body.games.some(g => g.id === gameId));
  assert.equal((await api(`/api/assistants/shared/${token}`)).status, 404);
});

test("suspending an account takes down its public things, stops its API keys and blocks deleting it", async () => {
  const maker = person("adult"), visitor = person();
  await api("/api/creators/mine", { method: "PUT", cookie: maker.cookie, body: { handle: "rule-breaker", bio: "", links: [], support: {} } });
  const gameId = liveGame(maker.user.id, "Rule Breaker Party");
  const token = await sharedAssistant(maker.cookie);
  const key = (await api("/api/developer/keys", { method: "POST", cookie: maker.cookie, body: { name: "Bot" } })).body.key;
  assert.equal((await api("/v1/me", { headers: { authorization: `Bearer ${key}` } })).status, 200);

  await suspend(maker.user.id);

  assert.equal((await api("/api/creators/rule-breaker", { cookie: visitor.cookie })).status, 404);
  assert.ok(!(await api("/api/creators")).body.creators.some(c => c.handle === "rule-breaker"));
  assert.ok(!(await api("/api/games")).body.games.some(g => g.id === gameId));
  assert.equal((await api(`/api/assistants/shared/${token}`)).status, 404);
  const v1 = await api("/v1/me", { headers: { authorization: `Bearer ${key}` } });
  assert.equal(v1.status, 403);
  assert.match(v1.body.error, /suspended/);
  // They can still reach billing, to stop paying for things that are now hidden.
  const billing = await api("/api/billing-portal", { method: "POST", cookie: maker.cookie, body: {} });
  assert.notEqual(billing.status, 403, billing.body?.error);
  assert.notEqual((await api(`/api/games/${gameId}/cancel`, { method: "POST", cookie: maker.cookie, body: {} })).status, 403);
  // Deleting the account and signing up again would shake off the suspension.
  const del = await api("/api/me", { method: "DELETE", cookie: maker.cookie, body: {} });
  assert.equal(del.status, 409);
  assert.match(del.body.error, /support ticket/);
});

test("data export downloads your rows and leaves secrets out", async () => {
  const me = signIn("exporter@example.com");
  const r = await api("/api/me/export", { cookie: me.cookie });
  assert.equal(r.status, 200);
  assert.equal(r.body.account.email, "exporter@example.com");
  assert.doesNotMatch(JSON.stringify(r.body), /token_hash|value_enc|key_hash/);
  assert.equal((await api("/api/me/export")).status, 401);
});

test("account type can be personal, student or business", async () => {
  const me = signIn("typer@example.com");
  assert.equal((await api("/api/me", { cookie: me.cookie })).body.user.accountType, "personal");
  assert.equal((await api("/api/me", { method: "PATCH", body: { accountType: "pirate" }, cookie: me.cookie })).status, 400);
  await api("/api/me", { method: "PATCH", body: { accountType: "business" }, cookie: me.cookie });
  assert.equal((await api("/api/me", { cookie: me.cookie })).body.user.accountType, "business");
});
