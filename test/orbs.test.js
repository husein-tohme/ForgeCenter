// Orbs: the wallet as ForgeCenter's own currency (1 orb = 1 cent), and orbs paying for
// AI messages once the free daily allowance runs out.
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { api, db, signIn, sendWebhook } from "./helpers.js";
import { installFakeStripe } from "./fake-stripe.js";
import { setEmailTransport } from "../src/email.js";
import { setModel } from "../src/ai.js";
import { setSupportModel } from "../src/support.js";
import { spendAllowance, refundAiSpend, ORBS_PER_AI_UNIT, FREE_DAILY } from "../src/tutor.js";

const emails = [];
setEmailTransport(async m => { emails.push(m); return true; });
const settle = () => new Promise(r => setImmediate(r)); // emails go out after the response

let stripe;
afterEach(() => { stripe?.restore(); stripe = null; });
after(() => { setModel(null); setSupportModel(null); });

const today = () => new Date().toISOString().slice(0, 10);
const give = (userId, orbs) => db.prepare(`INSERT INTO wallet_entries (user_id, amount, kind, note, created_at)
  VALUES (?, ?, 'credit', 'test', 'now')`).run(userId, orbs);
const balance = userId => db.prepare("SELECT COALESCE(SUM(amount), 0) AS c FROM wallet_entries WHERE user_id = ?").get(userId).c;
const entries = (userId, kind) => db.prepare("SELECT * FROM wallet_entries WHERE user_id = ? AND kind = ? ORDER BY id").all(userId, kind);
const used = userId => db.prepare("SELECT COALESCE(SUM(count), 0) AS c FROM tutor_usage WHERE user_id = ?").get(userId).c;
const setUsed = (userId, count) => db.prepare(`INSERT INTO tutor_usage (user_id, day, count) VALUES (?, ?, ?)
  ON CONFLICT(user_id, day) DO UPDATE SET count = excluded.count`).run(userId, today(), count);
const aiOrbs = (cookie, on) => api("/api/wallet/ai-orbs", { method: "PATCH", cookie, body: { on } });

// ---------- Wording and prices ----------
test("orb packs go through Checkout as \"2,500 ForgeCenter orbs\" and come back to the page they were bought on", async () => {
  stripe = installFakeStripe();
  const { cookie } = signIn("orb-pack@example.com");
  const r = await api("/api/wallet/topup", { method: "POST", cookie, body: { amount: 2500, from: "orbs" } });
  assert.equal(r.status, 200);
  const params = stripe.lastCheckout().params;
  const item = params.line_items[0].price_data;
  assert.equal(item.unit_amount, "2500");
  assert.equal(item.currency, "usd");
  assert.equal(item.product_data.name, "2,500 ForgeCenter orbs");
  assert.match(item.product_data.description, /can't be withdrawn, sold or sent to other people/);
  assert.match(params.success_url, /\/orbs\?topup=\d+$/);
  assert.match(params.cancel_url, /\/orbs#packs$/);

  await api("/api/wallet/topup", { method: "POST", cookie, body: { amount: 50000 } });
  const fromAccount = stripe.lastCheckout().params;
  assert.equal(fromAccount.line_items[0].price_data.product_data.name, "50,000 ForgeCenter orbs");
  assert.match(fromAccount.success_url, /\/account\?topup=\d+#wallet$/);

  // The webhook adds the pack once, as orbs (cents).
  const session = stripe.lastCheckout();
  const paid = { id: session.id, object: "checkout.session", status: "complete", payment_status: "paid", payment_intent: "pi_orbpack", metadata: session.metadata };
  await sendWebhook({ id: "evt_orbs_pack_1", type: "checkout.session.completed", data: { object: paid } });
  await sendWebhook({ id: "evt_orbs_pack_2", type: "checkout.session.completed", data: { object: paid } });
  assert.equal((await api("/api/wallet", { cookie })).body.balance, 50000);
});

test("wallet errors and emails talk in orbs", async () => {
  const { user, cookie } = signIn("orb-words@example.com");
  for (const amount of [250, 1050, 60000]) {
    const r = await api("/api/wallet/topup", { method: "POST", cookie, body: { amount } });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "Choose a number of orbs in hundreds, from 500 orbs to 50,000 orbs ($5 to $500).");
  }
  give(user.id, 199000);
  const nearlyFull = await api("/api/wallet/topup", { method: "POST", cookie, body: { amount: 5000 } });
  assert.equal(nearlyFull.body.error, "You can hold up to 200,000 orbs, so you can buy 1,000 orbs at most right now.");
  give(user.id, 600);
  const full = await api("/api/wallet/topup", { method: "POST", cookie, body: { amount: 500 } });
  assert.equal(full.body.error, "An account can hold up to 200,000 orbs, and yours has no room for another pack right now. Spend some orbs first.");
  db.prepare("DELETE FROM wallet_entries WHERE user_id = ?").run(user.id);

  give(user.id, 1000);
  const short = await api("/api/wallet/pay", { method: "POST", cookie, body: { product: "discord" } });
  assert.equal(short.status, 402);
  assert.equal(short.body.error, "You need 1,500 more orbs. Buy orbs at /orbs, or pay by card.");
  const monthly = await api("/api/wallet/pay", { method: "POST", cookie, body: { product: "mcserver" } });
  assert.match(monthly.body.error, /can't be paid with orbs/);

  give(user.id, 1500);
  emails.length = 0;
  const paid = await api("/api/wallet/pay", { method: "POST", cookie, body: { product: "discord" } });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.balance, 0);
  await settle();
  const thanks = emails.find(m => m.to.includes("orb-words@example.com") && /Thanks for your order/.test(m.subject));
  assert.match(thanks.text, /You paid for Discord bot with 2,500 orbs\./);
  assert.ok(emails.some(m => m.to.includes("owner@example.com") && /paid for Discord bot with 2,500 orbs/.test(m.text)));

  // The owner gives orbs and refunds as orbs; the customer's email says how many.
  const owner = signIn("owner@example.com");
  const tooMany = await api(`/api/admin/users/${user.id}/wallet-credit`, { method: "POST", cookie: owner.cookie, body: { amount: 50001, note: "x" } });
  assert.equal(tooMany.body.error, "Enter a number of orbs up to 50,000 orbs.");
  emails.length = 0;
  const gift = await api(`/api/admin/users/${user.id}/wallet-credit`, { method: "POST", cookie: owner.cookie, body: { amount: 550, note: "Sorry for the downtime" } });
  assert.equal(gift.status, 200);
  const refund = await api(`/api/admin/orders/${paid.body.orderId}/wallet-refund`, { method: "POST", cookie: owner.cookie, body: { amount: 20000 } });
  assert.match(refund.body.error, /At most 2,500 orbs \(\$25\) of this order/);
  await settle();
  const credited = emails.find(m => m.to.includes("orb-words@example.com"));
  assert.equal(credited.subject, "550 orbs added to your ForgeCenter account");
  assert.match(credited.text, /We added 550 orbs \(worth \$5\.50\) to your account for Sorry for the downtime\./);
  assert.match(credited.text, /Orbs never expire/);
  assert.doesNotMatch(credited.text, /wallet credit|\$5\.50 added/i);
});

test("the catalog marks what orbs can pay for, and the public orb facts need no sign-in", async () => {
  const catalog = (await api("/api/catalog")).body;
  assert.equal(catalog.discord.orbPayable, true);
  assert.equal(catalog.showcase.orbPayable, true);
  assert.equal(catalog.mcserver.orbPayable, false); // monthly: by card so it can renew
  assert.equal(catalog.website.orbPayable, false);
  assert.equal(catalog.game.orbPayable, true); // a $499 deposit fits in an account
  assert.equal(catalog.game.walletPayable, true);

  const info = (await api("/api/wallet/info")).body;
  assert.deepEqual(info.limits, { minTopup: 500, maxTopup: 50000, maxBalance: 200000 });
  assert.equal(info.orbsPerAiUnit, 5);
  assert.equal(ORBS_PER_AI_UNIT, 5);
  assert.deepEqual((await api("/api/tutor/limits")).body, { freeDaily: 30, aiPlanDaily: 300, orbsPerAiUnit: 5 });
});

test("Forge Support's help notes describe orbs", async () => {
  let system = "";
  setSupportModel(async params => { system = params.system.map(s => s.text).join("\n"); return { stop_reason: "end_turn", content: [{ type: "text", text: "OK" }] }; });
  const { user, cookie } = signIn("orb-support@example.com");
  give(user.id, 1234);
  const r = await api("/api/support", { method: "POST", cookie, body: { subject: "Orbs", category: "wallet", body: "How do orbs work?" } });
  assert.equal(r.status, 201);
  assert.match(system, /- Discord bot: \$25 \(or 2,500 orbs\)\./);
  assert.match(system, /- Fully furnished game \(deposit\): \$499 \(or 49,900 orbs\)\. /);
  assert.match(system, /each extra message costs 5 orbs/);
  assert.match(system, /How to buy and spend orbs: \/support#wallet/);
  assert.match(system, /Orb balance: 1,234 orbs/);
});

// ---------- The AI setting ----------
test("the AI orbs setting is off until the person turns it on, and only they can change it", async () => {
  const { cookie } = signIn("orb-setting@example.com");
  assert.equal((await api("/api/wallet", { cookie })).body.aiOrbs, false);
  assert.equal((await api("/api/wallet/ai-orbs", { method: "PATCH", body: { on: true } })).status, 401);
  assert.equal((await api("/api/wallet/ai-orbs", { method: "PATCH", cookie, body: { on: true }, headers: { origin: "https://evil.example" } })).status, 403);
  const bad = await aiOrbs(cookie, "yes");
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /on/);
  const on = await aiOrbs(cookie, true);
  assert.equal(on.status, 200);
  assert.deepEqual(on.body, { aiOrbs: true, orbsPerAiUnit: 5 });
  const w = (await api("/api/wallet", { cookie })).body;
  assert.equal(w.aiOrbs, true);
  assert.equal(w.orbsPerAiUnit, 5);
  assert.equal((await api("/api/tutor/usage", { cookie })).body.aiOrbs, true);
  assert.equal((await aiOrbs(cookie, false)).body.aiOrbs, false);
});

// ---------- The Forge mentor (its own Anthropic client, so the API is stubbed) ----------
// The SDK keeps the fetch it finds when the mentor's client is first made, so this
// stand-in stays in place for the whole file and passes everything else through.
const realFetch = globalThis.fetch;
const mentor = { calls: 0, fail: false };
const mentorFetch = async (input, init) => {
  const u = new URL(typeof input === "string" ? input : input.url ?? String(input));
  if (u.hostname !== "api.anthropic.com") return realFetch(input, init);
  mentor.calls++;
  const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (mentor.fail) return json({ type: "error", error: { type: "invalid_request_error", message: "Simulated failure" } }, 400);
  return json({ id: `msg_${mentor.calls}`, type: "message", role: "assistant", model: "claude-test", stop_reason: "end_turn",
    content: [{ type: "text", text: "Repeaters delay a signal by 1 to 4 ticks." }], usage: { input_tokens: 5, output_tokens: 9 } }, 200);
};
const askForge = cookie => api("/api/tutor", { method: "POST", cookie, body: { messages: [{ role: "user", content: "What does a repeater do?" }] } });

test("the mentor: out of free messages is a 429 that mentions the setting, and nothing is charged", async () => {
  process.env.ANTHROPIC_API_KEY = ["test", "anthropic", "key"].join("-");
  globalThis.fetch = mentorFetch;
  const { user, cookie } = signIn("orb-mentor-off@example.com");
  give(user.id, 1000);
  setUsed(user.id, FREE_DAILY);
  const before = mentor.calls;
  const r = await askForge(cookie);
  assert.equal(r.status, 429);
  assert.match(r.body.error, /You've used all 30 messages for today\. Forge resets at midnight UTC\./);
  assert.match(r.body.error, /turn on "When my free AI messages run out, use orbs" in the Orbs section of your account\. This would cost 5 orbs\./);
  assert.equal(mentor.calls, before);
  assert.equal(balance(user.id), 1000);
  assert.equal(entries(user.id, "ai").length, 0);
});

test("the mentor: free messages first, then orbs per message, then a 402 when orbs run out", async () => {
  globalThis.fetch = mentorFetch;
  const { user, cookie } = signIn("orb-mentor-on@example.com");
  await aiOrbs(cookie, true);
  give(user.id, 12);
  setUsed(user.id, FREE_DAILY - 2);

  // While free messages remain, nothing is charged.
  for (const left of [1, 0]) {
    const r = await askForge(cookie);
    assert.equal(r.status, 200);
    assert.equal(r.body.orbsSpent, 0);
    assert.equal(r.body.remaining, left);
  }
  assert.equal(balance(user.id), 12);
  assert.equal(used(user.id), FREE_DAILY);

  // Then each message costs ORBS_PER_AI_UNIT orbs, one ledger entry each.
  const paid = await askForge(cookie);
  assert.equal(paid.status, 200);
  assert.equal(paid.body.orbsSpent, 5);
  assert.equal(paid.body.remaining, 0);
  assert.match(paid.body.reply, /Repeaters/);
  assert.equal(balance(user.id), 7);
  assert.equal(used(user.id), FREE_DAILY); // paid messages don't count against the free ones
  const [charge] = entries(user.id, "ai");
  assert.equal(charge.amount, -5);
  assert.match(charge.ref, /^ai:[0-9a-f-]{36}$/);
  assert.equal(charge.note, "Forge mentor: 1 AI message after your free ones");
  const ledger = (await api("/api/wallet", { cookie })).body.entries;
  assert.equal(ledger[0].kind, "ai");
  assert.equal(ledger[0].amount, -5);

  // A failed answer gives the orbs back.
  mentor.fail = true;
  const failed = await askForge(cookie);
  mentor.fail = false;
  assert.equal(failed.status, 502);
  assert.match(failed.body.error, /Nothing was used/);
  assert.equal(balance(user.id), 7);
  assert.equal(entries(user.id, "ai_refund").length, 1);

  assert.equal((await askForge(cookie)).status, 200);
  assert.equal(balance(user.id), 2);

  // Not enough orbs left: a 402 that says so, and the model isn't called.
  const before = mentor.calls;
  const broke = await askForge(cookie);
  assert.equal(broke.status, 402);
  assert.equal(broke.body.error, "Your free AI messages are used up for today. This needs 5 orbs and you have 2 orbs. Buy more orbs at /orbs, or wait for your free messages to come back at midnight UTC.");
  assert.equal(mentor.calls, before);
  assert.equal(balance(user.id), 2);

  const usage = (await api("/api/tutor/usage", { cookie })).body;
  assert.deepEqual(usage, { used: FREE_DAILY, limit: FREE_DAILY, aiOrbs: true, orbsPerAiUnit: 5 });
});

// ---------- AI Maker: parallel chats ----------
test("parallel AI Maker chats can't spend more orbs than the balance holds", async () => {
  setModel(async () => {
    await new Promise(r => setTimeout(r, 20)); // keep the requests overlapping
    return { stop_reason: "end_turn", content: [{ type: "text", text: "Hi!" }], usage: { input_tokens: 1, output_tokens: 1 } };
  });
  const { user, cookie } = signIn("orb-race@example.com");
  const made = await api("/api/assistants", { method: "POST", cookie, body: {
    name: "Redstone Rex", avatar: "robot", greeting: "Hey!", instructions: "Help with redstone.", knowledge: "Repeaters delay signals." } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  await aiOrbs(cookie, true);
  setUsed(user.id, FREE_DAILY);
  give(user.id, 10); // enough for 2 messages

  const results = await Promise.all(Array.from({ length: 6 }, () =>
    api(`/api/assistants/${made.body.assistant.id}/chat`, { method: "POST", cookie, body: { messages: [{ role: "user", content: "Hi" }] } })));
  const statuses = results.map(r => r.status).sort();
  assert.deepEqual(statuses, [200, 200, 402, 402, 402, 402]);
  assert.equal(balance(user.id), 0);
  assert.equal(entries(user.id, "ai").length, 2);
  assert.ok(entries(user.id, "ai").every(e => e.note.startsWith("AI Maker:")));
  assert.match(results.find(r => r.status === 402).body.error, /needs 5 orbs and you have 0 orbs/);

  // With the setting off, the same thing is a 429 with the hint.
  await aiOrbs(cookie, false);
  const off = await api(`/api/assistants/${made.body.assistant.id}/chat`, { method: "POST", cookie, body: { messages: [{ role: "user", content: "Hi" }] } });
  assert.equal(off.status, 429);
  assert.match(off.body.error, /used all 30 AI messages for today.*This would cost 5 orbs\./);
});

// ---------- Site Maker: refunds ----------
const PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Creeper Cove</title></head>
<body><header><h1>Creeper Cove</h1></header><main><p>play.creepercove.net</p></main></body></html>`;
const SITE = { name: "Creeper Cove", description: "A survival server for friends with weekly build contests.", style: "pixel", sections: ["hero", "join-server"] };

test("a failed Site Maker build gives back both the free messages and the orbs", async () => {
  const replies = [];
  setModel(async () => {
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next ?? { stop_reason: "end_turn", content: [{ type: "text", text: PAGE }], usage: { input_tokens: 1, output_tokens: 1 } };
  });
  const { user, cookie } = signIn("orb-sites@example.com");
  const generate = () => api("/api/sites/generate", { method: "POST", cookie, body: SITE });
  setUsed(user.id, FREE_DAILY - 2);
  give(user.id, 100);

  // Setting off: a new site needs 5 messages, 2 are left, so 3 would be paid.
  const off = await generate();
  assert.equal(off.status, 429);
  assert.match(off.body.error, /This needs 5 AI messages and you have 2 left today\..*This would cost 15 orbs\./);

  await aiOrbs(cookie, true);
  replies.push(new Error("overloaded"));
  const failed = await generate();
  assert.equal(failed.status, 502);
  assert.equal(used(user.id), FREE_DAILY - 2);
  assert.equal(balance(user.id), 100);
  const [charge] = entries(user.id, "ai");
  assert.equal(charge.amount, -15);
  assert.equal(charge.note, "Site Maker: 3 AI messages after your free ones");
  const [back] = entries(user.id, "ai_refund");
  assert.equal(back.amount, 15);
  assert.equal(back.ref, `${charge.ref}:back`);

  replies.push({ stop_reason: "refusal", content: [], usage: { input_tokens: 1, output_tokens: 0 } });
  assert.equal((await generate()).status, 422);
  assert.equal(used(user.id), FREE_DAILY - 2);
  assert.equal(balance(user.id), 100);

  const built = await generate();
  assert.equal(built.status, 201);
  assert.equal(built.body.remaining, 0);
  assert.equal(used(user.id), FREE_DAILY);
  assert.equal(balance(user.id), 85);

  // A change costs 3 messages, all paid now.
  const refined = await api(`/api/sites/${built.body.site.id}/refine`, { method: "POST", cookie, body: { instruction: "Make it blue" } });
  assert.equal(refined.status, 201);
  assert.equal(balance(user.id), 70);
});

// ---------- spendAllowance itself ----------
test("spendAllowance keeps its old shape, and only callers that name a tool can spend orbs", () => {
  const { user } = signIn("orb-unit@example.com");
  db.prepare("UPDATE users SET ai_orbs = 1 WHERE id = ?").run(user.id);
  give(user.id, 50);
  setUsed(user.id, FREE_DAILY - 1);

  // Old-style callers (no tool) get free messages only, as before.
  const free = spendAllowance(user.id, 1);
  assert.equal(free.ok, true);
  assert.equal(free.limit, FREE_DAILY);
  assert.equal(free.remaining, 0);
  assert.equal(free.orbsSpent, 0);
  const no = spendAllowance(user.id, 1);
  assert.deepEqual({ ok: no.ok, limit: no.limit, remaining: no.remaining, reason: no.reason }, { ok: false, limit: FREE_DAILY, remaining: 0, reason: "allowance" });
  assert.equal(balance(user.id), 50);

  // A refund can come later from a stored receipt, and only counts once.
  free.refund();
  assert.equal(used(user.id), FREE_DAILY - 1);
  const mixed = spendAllowance(user.id, 3, { tool: "Test tool" });
  assert.equal(mixed.ok, true);
  assert.equal(mixed.orbsSpent, 10);
  assert.equal(balance(user.id), 40);
  const receipt = JSON.parse(JSON.stringify(mixed.receipt));
  assert.deepEqual(Object.keys(receipt).sort(), ["day", "free", "orbsSpent", "ref", "tool", "userId"]);
  assert.equal(refundAiSpend(receipt), true);
  assert.equal(refundAiSpend(receipt), false);
  assert.equal(mixed.refund(), false);
  assert.equal(balance(user.id), 50);
  assert.equal(used(user.id), FREE_DAILY - 1);
  free.refund(); // already given back: no extra free message
  assert.equal(used(user.id), FREE_DAILY - 1);

  // Inside a transaction someone else opened, it joins it instead of failing.
  db.exec("BEGIN IMMEDIATE");
  const nested = spendAllowance(user.id, 1, { tool: "Test tool" });
  db.exec("ROLLBACK");
  assert.equal(nested.ok, true);
  assert.equal(used(user.id), FREE_DAILY - 1);
});
