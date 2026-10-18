import { test, after } from "node:test";
import assert from "node:assert/strict";
import { api, db, signIn } from "./helpers.js";
import { installFakeStripe } from "./fake-stripe.js";

const stripe = installFakeStripe();
after(() => stripe.restore());

test("only adults can connect Stripe; links need a ready account", async () => {
  const teen = signIn("payteen@example.com");
  assert.equal((await api("/api/payouts/connect", { method: "POST", cookie: teen.cookie, body: {} })).status, 403);

  const adult = signIn("payadult@example.com", undefined, { age: "adult" });
  const r = await api("/api/payouts/connect", { method: "POST", cookie: adult.cookie, body: {} });
  assert.equal(r.status, 200, r.body.error);
  assert.match(r.body.url, /connect\.stripe\.com\/setup/);
  const early = await api("/api/payouts/links", { method: "POST", cookie: adult.cookie, body: { title: "Skin", amount: 5 } });
  assert.equal(early.status, 409);
});

test("a ready creator's pay link charges their own account with ForgeCenter's fee", async () => {
  const c = signIn("payready@example.com", undefined, { age: "adult" });
  await api("/api/payouts/connect", { method: "POST", cookie: c.cookie, body: {} });
  const acctId = db.prepare("SELECT account_id FROM payout_accounts WHERE user_id = ?").get(c.user.id).account_id;
  stripe.state.accounts.get(acctId).charges_enabled = true;

  const mine = await api("/api/payouts/mine", { cookie: c.cookie });
  assert.equal(mine.body.ready, true);

  assert.equal((await api("/api/payouts/links", { method: "POST", cookie: c.cookie, body: { title: "Skin", amount: 0.5 } })).status, 400);
  const made = await api("/api/payouts/links", { method: "POST", cookie: c.cookie, body: { title: "Custom skin", amount: 10 } });
  assert.equal(made.status, 200);
  const id = made.body.link.id;

  // Anyone can see and pay it, without signing in.
  assert.equal((await api(`/api/payouts/links/${id}`)).body.link.amount, 1000);
  const pay = await api(`/api/payouts/links/${id}/checkout`, { method: "POST", body: {} });
  assert.equal(pay.status, 200);
  const req = stripe.state.requests.findLast(x => x.path === "/v1/checkout/sessions");
  assert.equal(req.account, acctId);
  assert.equal(req.body.payment_intent_data.application_fee_amount, "50");

  // Suspended creators' links disappear.
  db.prepare("UPDATE users SET suspended_at = 'now' WHERE id = ?").run(c.user.id);
  assert.equal((await api(`/api/payouts/links/${id}`)).status, 404);
});
