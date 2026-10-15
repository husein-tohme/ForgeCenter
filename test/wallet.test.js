import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { api, db, sendWebhook, signIn } from "./helpers.js";
import { installFakeStripe } from "./fake-stripe.js";
import { setEmailTransport } from "../src/email.js";

let stripe;
afterEach(() => stripe?.restore());
const emails = [];
setEmailTransport(async m => { emails.push(m); return true; });

let eventId = 0;
const event = (type, object) => sendWebhook({ id: `evt_wallet_${++eventId}`, type, data: { object } });
const balance = async cookie => (await api("/api/wallet", { cookie })).body.balance;
const give = (userId, cents) => db.prepare(`INSERT INTO wallet_entries (user_id, amount, kind, note, created_at)
  VALUES (?, ?, 'credit', 'test', 'now')`).run(userId, cents);

async function topUp(cookie, amount) {
  const r = await api("/api/wallet/topup", { method: "POST", cookie, body: { amount } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return stripe.lastCheckout();
}
const paid = (session, pi = `pi_${session.id}`) =>
  ({ id: session.id, object: "checkout.session", mode: "payment", status: "complete", payment_status: "paid", payment_intent: pi, metadata: session.metadata });

test("a top-up goes through Stripe Checkout and is added once, by the webhook", async () => {
  stripe = installFakeStripe();
  const { cookie } = signIn("topup@example.com");
  const session = await topUp(cookie, 2500);
  assert.equal(session.params.mode, "payment");
  assert.equal(session.params.line_items[0].price_data.unit_amount, "2500");
  assert.equal(session.params.metadata.kind, "wallet_topup");
  assert.match(session.params.integration_identifier, /^forgecenter-wallet-[a-z]{8}$/);
  assert.equal(await balance(cookie), 0);

  // A bank payment completes unpaid first, and only counts once it settles.
  await event("checkout.session.completed", { ...paid(session), payment_status: "unpaid" });
  assert.equal(await balance(cookie), 0);
  await event("checkout.session.async_payment_succeeded", paid(session));
  assert.equal(await balance(cookie), 2500);
  await event("checkout.session.async_payment_succeeded", paid(session)); // replayed under a new event id
  assert.equal(await balance(cookie), 2500);
  const w = (await api("/api/wallet", { cookie })).body;
  assert.equal(w.entries[0].kind, "topup");
  assert.equal(w.pending.length, 0);
});

test("the wallet catches up with Stripe when the person lands back before the webhook", async () => {
  stripe = installFakeStripe();
  const { cookie } = signIn("early@example.com");
  const session = await topUp(cookie, 1000);
  Object.assign(stripe.state.sessions.get(session.id), { status: "complete", payment_status: "paid", payment_intent: "pi_early" });
  assert.equal(await balance(cookie), 1000);
});

test("top-ups must be whole dollars within the limits, and the wallet has a cap", async () => {
  stripe = installFakeStripe();
  const { user, cookie } = signIn("limits@example.com");
  for (const amount of [250, 1050, 60000, "100"]) {
    assert.equal((await api("/api/wallet/topup", { method: "POST", cookie, body: { amount } })).status, 400, String(amount));
  }
  give(user.id, 190000);
  const r = await api("/api/wallet/topup", { method: "POST", cookie, body: { amount: 20000 } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /\$100\.00 at most/);
});

test("paying from the wallet makes a paid order and starts it like a card payment", async () => {
  const { user, cookie } = signIn("spender@example.com");
  give(user.id, 15000);
  const r = await api("/api/wallet/pay", { method: "POST", cookie, body: { product: "discord" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.balance, 5000);
  const order = (await api(`/api/orders/${r.body.orderId}`, { cookie })).body.order;
  assert.equal(order.status, "paid");
  assert.equal(order.paidWith, "wallet");
  assert.equal(order.service.kind, "discord_bot"); // the bot setup starts straight away
  assert.ok(emails.some(m => m.subject.startsWith("New order: Discord bot")));

  const short = await api("/api/wallet/pay", { method: "POST", cookie, body: { product: "ai" } });
  assert.equal(short.status, 402);
  assert.match(short.body.error, /\$50\.00 short/);
  assert.equal((await api("/api/wallet/pay", { method: "POST", cookie, body: { product: "mcserver" } })).status, 400);
  assert.equal(await balance(cookie), 5000);
});

test("a top-up refunded from the Stripe Dashboard comes out of the wallet, once", async () => {
  stripe = installFakeStripe();
  const { cookie } = signIn("refundme@example.com");
  const session = await topUp(cookie, 3000);
  await event("checkout.session.completed", paid(session, "pi_refundme"));
  const charge = { id: "ch_refundme", object: "charge", payment_intent: "pi_refundme" };
  await event("charge.refunded", { ...charge, amount_refunded: 1000 });
  await event("charge.refunded", { ...charge, amount_refunded: 1000 });
  assert.equal(await balance(cookie), 2000);
  await event("charge.refunded", { ...charge, amount_refunded: 3000 });
  assert.equal(await balance(cookie), 0);
  // Refunds of ordinary orders aren't wallet business.
  await event("charge.refunded", { id: "ch_other", object: "charge", payment_intent: "pi_other", amount_refunded: 500 });
  assert.equal(await balance(cookie), 0);
});

test("the owner can refund an order or give credit to a wallet, within limits", async () => {
  const owner = signIn("owner@example.com");
  const c = signIn("refunded@example.com");
  give(c.user.id, 10000);
  const orderId = (await api("/api/wallet/pay", { method: "POST", cookie: c.cookie, body: { product: "ai" } })).body.orderId;

  const tooMuch = await api(`/api/admin/orders/${orderId}/wallet-refund`, { method: "POST", cookie: owner.cookie, body: { amount: 10001 } });
  assert.equal(tooMuch.status, 400);
  assert.equal((await api(`/api/admin/orders/${orderId}/wallet-refund`, { method: "POST", cookie: c.cookie, body: { amount: 100 } })).status, 403);
  const ok = await api(`/api/admin/orders/${orderId}/wallet-refund`, { method: "POST", cookie: owner.cookie, body: { amount: 6000 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.balance, 6000);
  assert.equal((await api(`/api/admin/orders/${orderId}/wallet-refund`, { method: "POST", cookie: owner.cookie, body: { amount: 4001 } })).status, 400);
  assert.ok(emails.some(m => m.to.includes("refunded@example.com") && /\$60\.00 added/.test(m.subject)));

  const noNote = await api(`/api/admin/users/${c.user.id}/wallet-credit`, { method: "POST", cookie: owner.cookie, body: { amount: 500 } });
  assert.equal(noNote.status, 400);
  const credit = await api(`/api/admin/users/${c.user.id}/wallet-credit`, { method: "POST", cookie: owner.cookie, body: { amount: 500, note: "Sorry for the downtime" } });
  assert.equal(credit.body.balance, 6500);
  const entries = (await api("/api/wallet", { cookie: c.cookie })).body.entries;
  assert.deepEqual(entries.slice(0, 3).map(e => e.kind), ["credit", "refund", "purchase"]);
});

test("an account with wallet credit can't be deleted until it's spent or refunded", async () => {
  const { user, cookie } = signIn("rich@example.com");
  give(user.id, 700);
  const r = await api("/api/me", { method: "DELETE", cookie, body: {} });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /\$7\.00 in your wallet/);
});
