import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { api, db, sendWebhook, signIn } from "./helpers.js";
import { installFakeStripe } from "./fake-stripe.js";
import { setEmailTransport } from "../src/email.js";

let stripe;
afterEach(() => stripe?.restore());
let outbox = [];
setEmailTransport(async m => { outbox.push(m); return true; });
const settle = () => new Promise(r => setTimeout(r, 20));

let eventId = 0;
const event = (type, object) => sendWebhook({ id: `evt_donation_${++eventId}`, type, data: { object } });
const donation = id => db.prepare("SELECT * FROM donations WHERE id = ?").get(id);
const payments = id => ({ ...db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS cents
  FROM donation_payments WHERE donation_id = ?`).get(id) });
const donationMeta = id => ({ kind: "donation", donation_id: String(id) });

async function give(body, cookie) {
  const r = await api("/api/donations", { method: "POST", body, cookie });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { id: r.body.donationId, session: stripe.lastCheckout() };
}
// The Checkout Session as Stripe sends it in a webhook once the donor finishes.
const completed = (session, extra = {}) => ({ id: session.id, object: "checkout.session", mode: session.mode,
  status: "complete", payment_status: "paid", metadata: session.metadata, ...extra });

test("donations must be whole dollars from $1 to $500", async () => {
  stripe = installFakeStripe();
  const options = (await api("/api/donations/options")).body;
  assert.deepEqual(options, { available: true, limits: { min: 100, max: 50000 } });

  const { cookie } = signIn("amounts@example.com");
  for (const amount of [0, 50, 150, 50050, 50100, -100, "500", "$5", null]) {
    const r = await api("/api/donations", { method: "POST", cookie, body: { amount } });
    assert.equal(r.status, 400, String(amount));
    assert.match(r.body.error, /\$1 to \$500/);
  }
  assert.equal(stripe.state.requests.length, 0);

  const ok = signIn("edges@example.com");
  for (const amount of [100, 50000]) {
    assert.equal((await api("/api/donations", { method: "POST", cookie: ok.cookie, body: { amount } })).status, 200, String(amount));
  }
});

test("anyone can give once without an account, through Checkout in donate mode", async () => {
  stripe = installFakeStripe();
  const { id, session } = await give({ amount: 500, monthly: false, showName: true });
  const p = session.params;
  assert.equal(p.mode, "payment");
  assert.equal(p.submit_type, "donate");
  assert.equal(p.customer, undefined); // Stripe asks for the email
  assert.ok(!stripe.state.requests.some(r => r.path === "/v1/customers"));
  assert.deepEqual(p.metadata, donationMeta(id));
  assert.deepEqual(p.payment_intent_data.metadata, donationMeta(id));
  assert.equal(p.subscription_data, undefined);
  const price = p.line_items[0].price_data;
  assert.equal(price.unit_amount, "500");
  assert.equal(price.currency, "usd");
  assert.equal(price.recurring, undefined);
  assert.equal(price.product_data.name, "Support ForgeCenter");
  assert.match(p.custom_text.submit.message, /aren't tax-deductible/);
  assert.match(p.custom_text.submit.message, /aren't refunded unless something went wrong/);
  assert.match(p.success_url, /\/donate\?thanks=1/);
  assert.match(p.cancel_url, /\/donate$/);
  assert.match(p.integration_identifier, /^forgecenter-donation-[a-z]{8}$/);
  // The fake Stripe also checks that payment_method_types is never sent.

  const d = donation(id);
  assert.equal(d.user_id, null);
  assert.equal(d.public_name, 0); // there's no account to show on the wall
  assert.equal(d.status, "awaiting_payment");
  assert.equal(d.stripe_session_id, session.id);
});

test("monthly donations need an account and use a monthly subscription", async () => {
  stripe = installFakeStripe();
  const out = await api("/api/donations", { method: "POST", body: { amount: 300, monthly: true } });
  assert.equal(out.status, 401);
  assert.match(out.body.error, /Sign in to give monthly/);
  const fresh = signIn("new-donor@example.com", "new-donor@example.com", { age: null });
  const early = await api("/api/donations", { method: "POST", cookie: fresh.cookie, body: { amount: 300, monthly: true } });
  assert.equal(early.status, 403);
  assert.equal(early.body.needs, "birthday");
  assert.equal(stripe.state.sessions.size, 0);

  const { user, cookie } = signIn("monthly@example.com");
  const { id, session } = await give({ amount: 300, monthly: true, showName: true }, cookie);
  const p = session.params;
  assert.equal(p.mode, "subscription");
  assert.equal(p.submit_type, "donate");
  assert.match(p.customer, /^cus_/);
  assert.deepEqual(p.line_items[0].price_data.recurring, { interval: "month" });
  assert.equal(p.line_items[0].price_data.unit_amount, "300");
  assert.deepEqual(p.metadata, donationMeta(id));
  assert.deepEqual(p.subscription_data.metadata, donationMeta(id));
  assert.equal(p.payment_intent_data, undefined);
  assert.match(p.custom_text.submit.message, /repeats every month/);
  assert.match(p.success_url, /\/donate\?thanks=1/);
  const d = donation(id);
  assert.equal(d.user_id, user.id);
  assert.equal(d.monthly, 1);
  assert.equal(d.public_name, 1);
});

test("the webhook marks a donation paid once, waits for bank payments, and thanks signed-in donors", async () => {
  stripe = installFakeStripe();
  outbox = [];
  const { cookie } = signIn("giver@example.com");
  const { id, session } = await give({ amount: 1000 }, cookie);

  // A bank payment completes unpaid first, and only counts once it settles.
  await event("checkout.session.completed", completed(session, { payment_status: "unpaid" }));
  assert.equal(donation(id).status, "awaiting_payment");
  assert.equal(payments(id).n, 0);

  await event("checkout.session.async_payment_succeeded", completed(session));
  await event("checkout.session.async_payment_succeeded", completed(session)); // replayed under a new event id
  const d = donation(id);
  assert.equal(d.status, "paid");
  assert.ok(d.paid_at);
  assert.deepEqual(payments(id), { n: 1, cents: 1000 });

  // A late expiry doesn't undo it.
  await event("checkout.session.expired", completed(session, { status: "expired" }));
  assert.equal(donation(id).status, "paid");

  await settle();
  const thanks = outbox.filter(m => m.subject === "Thank you for supporting ForgeCenter");
  assert.equal(thanks.length, 1);
  assert.deepEqual(thanks[0].to, ["giver@example.com"]);
  assert.match(thanks[0].text, /\$10 donation/);
});

test("abandoned and failed checkouts never count, and visitors get their receipt from Stripe only", async () => {
  stripe = installFakeStripe();
  outbox = [];
  const a = await give({ amount: 200 });
  await event("checkout.session.expired", completed(a.session, { status: "expired", payment_status: "unpaid" }));
  assert.equal(donation(a.id).status, "expired");

  const b = await give({ amount: 200 });
  await event("checkout.session.completed", completed(b.session, { payment_status: "unpaid" }));
  await event("checkout.session.async_payment_failed", completed(b.session, { payment_status: "unpaid" }));
  assert.equal(donation(b.id).status, "payment_failed");
  assert.equal(payments(a.id).n + payments(b.id).n, 0);

  const c = await give({ amount: 200 });
  await event("checkout.session.completed", completed(c.session));
  assert.equal(donation(c.id).status, "paid");
  await settle();
  assert.equal(outbox.length, 0);
});

test("the return page catches up with Stripe but never counts an unpaid checkout", async () => {
  stripe = installFakeStripe();
  const { cookie } = signIn("early-donor@example.com");
  const other = signIn("nosy@example.com");
  const { id, session } = await give({ amount: 500 }, cookie);

  // Back on the site before the webhook, with a bank payment that hasn't settled.
  Object.assign(stripe.state.sessions.get(session.id), { status: "complete", payment_status: "unpaid" });
  let r = await api(`/api/donations/${id}`, { cookie });
  assert.equal(r.status, 200);
  assert.equal(r.body.donation.status, "awaiting_payment");

  Object.assign(stripe.state.sessions.get(session.id), { payment_status: "paid" });
  r = await api(`/api/donations/${id}`, { cookie });
  assert.equal(r.body.donation.status, "paid");
  assert.equal(payments(id).n, 1);
  await event("checkout.session.completed", completed(session)); // the webhook, arriving late
  assert.equal(payments(id).n, 1);

  assert.equal((await api(`/api/donations/${id}`, { cookie: other.cookie })).status, 404);
  assert.equal((await api(`/api/donations/${id}`)).status, 401);
});

test("subscription events go to donations or orders by their kind, never both", async () => {
  stripe = installFakeStripe();
  const { user, cookie } = signIn("router@example.com");
  const { id, session } = await give({ amount: 500, monthly: true }, cookie);
  await event("checkout.session.completed", completed(session, { subscription: "sub_don_route", invoice: "in_don_first" }));
  assert.equal(donation(id).stripe_subscription_id, "sub_don_route");

  // A hosting order with its own subscription.
  const orderId = Number(db.prepare(`INSERT INTO orders (user_id, product, amount, monthly, status, subscription_status,
      stripe_subscription_id, created_at, updated_at) VALUES (?, 'mcserver', 0, 10000, 'delivered', 'active', 'sub_ord_route', 'now', 'now')`)
    .run(user.id).lastInsertRowid);
  const orderSub = () => db.prepare("SELECT subscription_status FROM orders WHERE id = ?").get(orderId).subscription_status;
  const orderMeta = { kind: "order", order_id: String(orderId) };
  const invoice = (invoiceId, sub, metadata, reason = "subscription_cycle", amount = 500) =>
    ({ id: invoiceId, object: "invoice", billing_reason: reason, amount_paid: amount, parent: { subscription_details: { subscription: sub, metadata } } });

  // The donation's first invoice is the Checkout payment, which was already counted.
  await event("invoice.paid", invoice("in_don_first", "sub_don_route", donationMeta(id), "subscription_create"));
  assert.deepEqual(payments(id), { n: 1, cents: 500 });

  // The order's billing changes reach the order and leave the donation alone.
  await event("customer.subscription.updated", { id: "sub_ord_route", object: "subscription", status: "past_due", metadata: orderMeta });
  assert.equal(orderSub(), "past_due");
  assert.equal(donation(id).status, "paid");
  await event("invoice.paid", invoice("in_ord_2", "sub_ord_route", orderMeta, "subscription_cycle", 10000));
  assert.equal(orderSub(), "active");
  assert.deepEqual(payments(id), { n: 1, cents: 500 });

  // A renewal of the donation counts once and leaves the order alone.
  db.prepare("UPDATE orders SET subscription_status = 'past_due' WHERE id = ?").run(orderId);
  await event("invoice.paid", invoice("in_don_2", "sub_don_route", donationMeta(id)));
  await event("invoice.paid", invoice("in_don_2", "sub_don_route", donationMeta(id)));
  assert.deepEqual(payments(id), { n: 2, cents: 1000 });
  assert.equal(orderSub(), "past_due");

  // A failed renewal marks it overdue until a payment goes through again.
  await event("customer.subscription.updated", { id: "sub_don_route", object: "subscription", status: "past_due", metadata: donationMeta(id) });
  assert.equal(donation(id).overdue, 1);
  await event("customer.subscription.updated", { id: "sub_don_route", object: "subscription", status: "active", metadata: donationMeta(id) });
  assert.equal(donation(id).overdue, 0);

  // Cancelled in Manage billing: it runs to the end of the month already given, then ends.
  const periodEnd = Math.floor(Date.now() / 1000) + 20 * 86400;
  await event("customer.subscription.updated", { id: "sub_don_route", object: "subscription", status: "active", cancel_at: periodEnd, metadata: donationMeta(id) });
  assert.equal(donation(id).status, "paid");
  assert.equal(donation(id).ends_at, new Date(periodEnd * 1000).toISOString());
  await event("customer.subscription.deleted", { id: "sub_don_route", object: "subscription", status: "canceled", ended_at: periodEnd, metadata: donationMeta(id) });
  assert.equal(donation(id).status, "canceled");
  assert.equal(orderSub(), "past_due");
});

test("the supporters wall shows only signed-in donors who opted in, by display name", async () => {
  stripe = installFakeStripe();
  const shown = signIn("shown@example.com"), quiet = signIn("quiet@example.com");
  const unpaid = signIn("unpaid@example.com"), regular = signIn("regular@example.com");
  db.prepare("UPDATE users SET name = 'Steve the Builder' WHERE id = ?").run(shown.user.id);
  const pay = async (body, cookie) => {
    const g = await give(body, cookie);
    await event("checkout.session.completed", completed(g.session, body.monthly ? { subscription: `sub_wall_${g.id}` } : {}));
  };
  await pay({ amount: 2500, showName: true }, shown.cookie);
  await pay({ amount: 2500, showName: false }, quiet.cookie);
  await give({ amount: 2500, showName: true }, unpaid.cookie); // never paid
  await pay({ amount: 500, monthly: true, showName: true }, regular.cookie);
  await pay({ amount: 10000, showName: true }); // a visitor: there's no name to show

  const r = await api("/api/donations/wall");
  assert.equal(r.status, 200);
  const names = r.body.supporters.map(s => s.name);
  assert.ok(names.includes("Steve the Builder"));
  assert.ok(names.includes("regular"));
  assert.ok(!names.includes("quiet"));
  assert.ok(!names.includes("unpaid"));
  assert.equal(r.body.supporters.length, 2);
  for (const s of r.body.supporters) assert.deepEqual(Object.keys(s).sort(), ["monthly", "name"]);
  assert.equal(r.body.supporters.find(s => s.name === "regular").monthly, true);
  assert.equal(r.body.supporters.find(s => s.name === "Steve the Builder").monthly, false);
  assert.doesNotMatch(JSON.stringify(r.body), /example\.com|2500|10000|amount/);

  // Changing your mind takes your name off the wall.
  const mine = await api("/api/donations/mine", { cookie: shown.cookie });
  assert.equal(mine.body.onWall, true);
  const off = await api("/api/donations/mine", { method: "PATCH", cookie: shown.cookie, body: { showName: false } });
  assert.equal(off.body.onWall, false);
  assert.ok(!(await api("/api/donations/wall")).body.supporters.some(s => s.name === "Steve the Builder"));
});

test("the owner overview counts this month's donations, renewals included, apart from sales", async () => {
  stripe = installFakeStripe();
  const owner = signIn("owner@example.com");
  const before = (await api("/api/admin/overview", { cookie: owner.cookie })).body;
  const { cookie } = signIn("counted@example.com");
  const { id, session } = await give({ amount: 700, monthly: true }, cookie);
  await event("checkout.session.completed", completed(session, { subscription: "sub_counted", invoice: "in_counted_1" }));
  await event("invoice.paid", { id: "in_counted_2", object: "invoice", billing_reason: "subscription_cycle", amount_paid: 700,
    parent: { subscription_details: { subscription: "sub_counted", metadata: donationMeta(id) } } });

  const after = (await api("/api/admin/overview", { cookie: owner.cookie })).body;
  assert.equal(after.donationsCents - before.donationsCents, 1400);
  assert.deepEqual(after.sales, before.sales);
});

test("a monthly donor cancels before deleting their account, and the record is kept without them", async () => {
  stripe = installFakeStripe();
  const { cookie } = signIn("leaver@example.com");
  const { id, session } = await give({ amount: 300, monthly: true }, cookie);
  await event("checkout.session.completed", completed(session, { subscription: "sub_leaver" }));
  const mine = (await api("/api/donations/mine", { cookie })).body;
  assert.equal(mine.activeMonthly, true);
  assert.deepEqual(mine.donations.map(d => [d.amount, d.monthly, d.status]), [[300, true, "paid"]]);

  const blocked = await api("/api/me", { method: "DELETE", cookie, body: {} });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /Manage billing/);

  await event("customer.subscription.deleted", { id: "sub_leaver", object: "subscription", status: "canceled", metadata: donationMeta(id) });
  assert.equal((await api("/api/me", { method: "DELETE", cookie, body: {} })).status, 200);
  assert.equal(donation(id).user_id, null);
  assert.equal(donation(id).status, "canceled");
});
