import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { api, db, signIn } from "./helpers.js";
import { setSupportModel } from "../src/support.js";
import { setEmailTransport } from "../src/email.js";
import { signInWith, createSession } from "../src/auth.js";

const emails = [];
setEmailTransport(async m => { emails.push(m); return true; });

// A stand-in for Claude: each test queues the responses it should give.
let replies, requests;
const text = t => ({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: t }] });
const handOver = note => ({ stop_reason: "tool_use", content: [
  { type: "text", text: "Let me get a person." },
  { type: "tool_use", id: "toolu_1", name: "hand_to_person", input: { note } },
] });
beforeEach(() => {
  replies = []; requests = [];
  setSupportModel(async (params, options) => {
    requests.push(structuredClone(params));
    assert.ok(options.timeout > 0);
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next ?? text("OK");
  });
});
after(() => setSupportModel(null));

const open = (cookie, body = {}) => api("/api/support", { method: "POST", cookie, body: {
  subject: "My bot is offline", category: "bot", body: "It says crashed. What do I do?", ...body } });

test("Forge Support answers from the help notes and only this customer's orders", async () => {
  const me = signIn("helpme@example.com");
  const other = signIn("someone-else@example.com");
  const mine = Number(db.prepare(`INSERT INTO orders (user_id, product, amount, status, created_at, updated_at)
    VALUES (?, 'discord', 10000, 'paid', '2026-10-01T00:00:00Z', 'now')`).run(me.user.id).lastInsertRowid);
  db.prepare(`INSERT INTO services (order_id, kind, state, bot_status, last_error, created_at, updated_at)
    VALUES (?, 'discord_bot', 'active', 'crashed', 'The bot stopped (exit code 1).', 'now', 'now')`).run(mine);
  const theirs = Number(db.prepare(`INSERT INTO orders (user_id, product, amount, status, created_at, updated_at)
    VALUES (?, 'mcserver', 0, 'paid', 'now', 'now')`).run(other.user.id).lastInsertRowid);

  replies.push(text("Press Restart on your order page, then check the token."));
  const r = await open(me.cookie, { orderId: mine });
  assert.equal(r.status, 201);
  const t = r.body.ticket;
  assert.equal(t.status, "ai");
  assert.deepEqual(t.messages.map(m => m.author), ["customer", "ai"]);
  assert.equal(t.messages[1].body, "Press Restart on your order page, then check the token.");

  const req = requests[0];
  assert.equal(req.model, "claude-opus-5-5");
  assert.equal(req.fallbacks, "default");
  assert.deepEqual(req.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(req.tools[0].name, "hand_to_person");
  assert.deepEqual(req.system[0].cache_control, { type: "ephemeral" });
  assert.match(req.system[0].text, /Minecraft server hosting: \$100 a month/);
  assert.match(req.system[0].text, /How to add funds and pay from your wallet: \/support#wallet/);
  const context = req.system[1].text;
  assert.match(context, new RegExp(`Order ${mine}: Discord bot.*bot crashed.*exit code 1`));
  assert.doesNotMatch(context, new RegExp(`Order ${theirs}`));
  assert.match(context, /Age group: teen/);
  assert.deepEqual(req.messages, [{ role: "user", content: "It says crashed. What do I do?" }]);
  // The stable part of the prompt doesn't change between customers, so it can be cached.
  await open(other.cookie);
  assert.equal(requests[1].system[0].text, req.system[0].text);
});

test("money questions go to a person, with a note for the owner", async () => {
  const { cookie } = signIn("refund-please@example.com");
  replies.push(handOver("Wants a refund for the Discord bot."), text("A person will reply here soon."));
  const r = await open(cookie, { category: "billing", subject: "Refund", body: "Can I get my money back?" });
  const t = r.body.ticket;
  assert.equal(t.status, "waiting");
  assert.equal(t.messages.at(-1).body, "A person will reply here soon.");
  // The second request continues the first: the whole response, then the tool result.
  const second = requests[1].messages;
  assert.equal(second[1].role, "assistant");
  assert.equal(second[1].content[1].type, "tool_use");
  assert.equal(second[2].content[0].tool_use_id, "toolu_1");
  assert.ok(emails.some(m => m.subject.startsWith(`Support ticket ${t.id} needs you`) && m.text.includes("Wants a refund")));
  // Once a person has it, new messages don't go to the AI.
  const before = requests.length;
  await api(`/api/support/${t.id}/messages`, { method: "POST", cookie, body: { body: "Thanks!" } });
  assert.equal(requests.length, before);
});

test("if the AI fails or declines, the ticket goes to a person instead of erroring", async () => {
  const { cookie } = signIn("unlucky@example.com");
  replies.push(new Error("overloaded"));
  const failed = (await open(cookie)).body.ticket;
  assert.equal(failed.status, "waiting");
  assert.match(failed.messages.at(-1).body, /a person will reply/);

  replies.push({ stop_reason: "refusal", content: [] });
  const declined = (await open(cookie, { subject: "Another" })).body.ticket;
  assert.equal(declined.status, "waiting");
});

test("accounts without an email aren't promised one", async () => {
  const u = signInWith({ provider: "whatsapp", subject: "+447700900123", phone: "+447700900123", name: "Pat" });
  db.prepare("UPDATE users SET age_group = 'teen' WHERE id = ?").run(u.id);
  const cookie = `fc_session=${createSession(u.id)}`;
  replies.push(new Error("overloaded"));
  const t = (await open(cookie)).body.ticket;
  assert.doesNotMatch(t.messages.at(-1).body, /email/i);
  assert.match(t.messages.at(-1).body, /check back here/);
  replies.push(text("Sure."));
  await open(cookie, { subject: "Second" });
  assert.match(requests.at(-1).system[1].text, /Email address on the account: no/);
});

test("customers see only their own tickets, and the owner can reply and close them", async () => {
  const owner = signIn("owner@example.com");
  const a = signIn("ticket-a@example.com"), b = signIn("ticket-b@example.com");
  const t = (await open(a.cookie)).body.ticket;
  assert.equal((await api(`/api/support/${t.id}`, { cookie: b.cookie })).status, 404);
  assert.equal((await api(`/api/support/${t.id}/messages`, { method: "POST", cookie: b.cookie, body: { body: "hi" } })).status, 404);
  assert.equal((await api("/api/admin/tickets", { cookie: a.cookie })).status, 403);

  // "Talk to a person" moves it to the owner's queue.
  const handed = await api(`/api/support/${t.id}/handoff`, { method: "POST", cookie: a.cookie, body: {} });
  assert.equal(handed.body.ticket.status, "waiting");
  const queue = (await api("/api/admin/tickets?status=waiting", { cookie: owner.cookie })).body.tickets;
  assert.ok(queue.some(x => x.id === t.id && x.customer === "ticket-a@example.com"));
  const full = (await api(`/api/support/${t.id}`, { cookie: owner.cookie })).body.ticket;
  assert.equal(full.handoffNote, "The customer asked for a person.");
  assert.equal(full.customer.email, "ticket-a@example.com");

  const reply = await api(`/api/admin/tickets/${t.id}/messages`, { method: "POST", cookie: owner.cookie, body: { body: "Restarted it for you." } });
  assert.equal(reply.body.ticket.status, "answered");
  assert.ok(emails.some(m => m.to.includes("ticket-a@example.com") && m.text.includes("Restarted it for you.")));
  // The owner can't post as the customer, and a customer reply sends it back to the owner.
  assert.equal((await api(`/api/support/${t.id}/messages`, { method: "POST", cookie: owner.cookie, body: { body: "x" } })).status, 403);
  const back = await api(`/api/support/${t.id}/messages`, { method: "POST", cookie: a.cookie, body: { body: "Works now, thanks" } });
  assert.equal(back.body.ticket.status, "waiting");

  await api(`/api/admin/tickets/${t.id}/close`, { method: "POST", cookie: owner.cookie, body: {} });
  const closed = await api(`/api/support/${t.id}/messages`, { method: "POST", cookie: a.cookie, body: { body: "One more thing" } });
  assert.equal(closed.status, 409);
});

test("without an API key, tickets go straight to the owner", async () => {
  setSupportModel(null);
  const { cookie } = signIn("no-ai@example.com");
  const r = await open(cookie);
  assert.equal(r.body.ticket.status, "waiting");
  assert.deepEqual(r.body.ticket.messages.map(m => m.author), ["customer"]);
  assert.equal((await api("/api/support", { cookie })).body.ai, false);
});

test("tickets are checked and limited", async () => {
  const { cookie } = signIn("busy-bee@example.com");
  const other = signIn("not-yours@example.com");
  const theirOrder = Number(db.prepare(`INSERT INTO orders (user_id, product, amount, status, created_at, updated_at)
    VALUES (?, 'ai', 10000, 'paid', 'now', 'now')`).run(other.user.id).lastInsertRowid);
  assert.equal((await open(cookie, { category: "nonsense" })).status, 400);
  assert.equal((await open(cookie, { body: "  " })).status, 400);
  assert.equal((await open(cookie, { orderId: theirOrder })).status, 400);
  for (let i = 0; i < 5; i++) assert.equal((await open(cookie, { subject: `Ticket ${i}` })).status, 201);
  assert.equal((await open(cookie, { subject: "One too many" })).status, 429);
});
