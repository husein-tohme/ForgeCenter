import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { api, makeOrder, sendWebhook, signIn } from "./helpers.js";
import { setEmailTransport } from "../src/email.js";

let outbox = [];
setEmailTransport(async message => { outbox.push(message); return true; });
beforeEach(() => { outbox = []; });
const settle = () => new Promise(r => setTimeout(r, 20));

test("a paid order emails the owner and the customer", async () => {
  const { user } = signIn("buyer@example.com");
  const id = makeOrder(user.id, "website");
  await sendWebhook({ id: "evt_mail_1", type: "checkout.session.completed", data: { object: {
    mode: "payment", payment_status: "paid", metadata: { order_id: String(id) } } } });
  await settle();
  assert.deepEqual(outbox.map(m => m.to[0]).sort(), ["buyer@example.com", "owner@example.com"]);
  assert.match(outbox.find(m => m.to[0] === "buyer@example.com").text, /project brief/);
});

test("status changes and replies email the customer; customer messages email the owner", async () => {
  const cust = signIn("client@example.com"), owner = signIn("owner@example.com");
  const id = makeOrder(cust.user.id, "discord", "paid");

  await api(`/api/admin/orders/${id}`, { method: "PATCH", body: { status: "delivered", deliverableUrl: "https://example.com/bot" }, cookie: owner.cookie });
  await settle();
  assert.equal(outbox.length, 1);
  assert.match(outbox[0].text, /ready!.*https:\/\/example\.com\/bot/);

  outbox = [];
  await api(`/api/admin/orders/${id}`, { method: "PATCH", body: { deliverableUrl: "https://example.com/bot2" }, cookie: owner.cookie });
  await settle();
  assert.equal(outbox.length, 0, "no email when the status didn't change");

  await api(`/api/orders/${id}/messages`, { method: "POST", body: { body: "Thanks!" }, cookie: cust.cookie });
  await api(`/api/orders/${id}/messages`, { method: "POST", body: { body: "You're welcome" }, cookie: owner.cookie });
  await settle();
  assert.deepEqual(outbox.map(m => m.to[0]), ["owner@example.com", "client@example.com"]);
});

test("a broken email service never breaks the request", async () => {
  setEmailTransport(async () => { throw new Error("down"); });
  try {
    const { user, cookie } = signIn("calm@example.com");
    const id = makeOrder(user.id, "ai", "paid");
    const r = await api(`/api/orders/${id}/messages`, { method: "POST", body: { body: "Hello" }, cookie });
    assert.equal(r.status, 200);
  } finally { setEmailTransport(async m => { outbox.push(m); return true; }); }
});
