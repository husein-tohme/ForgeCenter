import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { api, db, makeOrder, sendWebhook, signIn, url } from "./helpers.js";

test("visitors are signed out and can't buy", async () => {
  assert.equal((await api("/api/me")).body.user, null);
  assert.equal((await api("/api/checkout", { method: "POST", body: { product: "website" } })).status, 401);
  assert.equal((await api("/api/tutor", { method: "POST", body: { messages: [] } })).status, 401);
});

test("a fake Google credential is rejected", async () => {
  const r = await api("/api/auth/google", { method: "POST", body: { credential: "not-a-real-token" } });
  assert.equal(r.status, 401);
});

test("a valid session signs the user in and logout ends it", async () => {
  const { cookie } = signIn("ana@example.com");
  const me = await api("/api/me", { cookie });
  assert.equal(me.body.user.email, "ana@example.com");
  assert.equal(me.body.user.isAdmin, false);
  await api("/api/auth/logout", { method: "POST", body: {}, cookie });
  assert.equal((await api("/api/me", { cookie })).body.user, null);
});

test("cross-site and non-JSON writes are blocked", async () => {
  const { cookie } = signIn("csrf@example.com");
  const cross = await api("/api/auth/logout", { method: "POST", body: {}, cookie, headers: { origin: "https://evil.example" } });
  assert.equal(cross.status, 403);
  const form = await api("/api/auth/logout", { method: "POST", body: "a=1", cookie, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  assert.equal(form.status, 415);
});

test("unknown products are rejected", async () => {
  const { cookie } = signIn("buyer@example.com");
  assert.equal((await api("/api/checkout", { method: "POST", body: { product: "free-money" }, cookie })).status, 400);
});

test("signed Stripe webhooks mark orders paid, once", async () => {
  const { user, cookie } = signIn("paid@example.com");
  const id = makeOrder(user.id, "discord");
  const event = { id: "evt_1", type: "checkout.session.completed", data: { object: {
    id: "cs_x", mode: "payment", payment_status: "paid", metadata: { order_id: String(id) } } } };
  assert.equal((await sendWebhook(event)).status, 200);
  assert.equal((await api(`/api/orders/${id}`, { cookie })).body.order.status, "paid");

  // Replaying the same event does nothing; a forged signature is refused.
  db.prepare("UPDATE orders SET status = 'in_progress' WHERE id = ?").run(id);
  assert.equal((await sendWebhook(event)).status, 200);
  assert.equal((await api(`/api/orders/${id}`, { cookie })).body.order.status, "in_progress");
  const forged = await fetch(url("/api/stripe/webhook"), { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=bad" }, body: JSON.stringify(event) });
  assert.equal(forged.status, 400);
});

test("delayed payments wait until they settle", async () => {
  const { user, cookie } = signIn("bank@example.com");
  const id = makeOrder(user.id, "ai");
  const obj = { mode: "payment", payment_status: "unpaid", metadata: { order_id: String(id) } };
  await sendWebhook({ id: "evt_2", type: "checkout.session.completed", data: { object: obj } });
  assert.equal((await api(`/api/orders/${id}`, { cookie })).body.order.status, "awaiting_payment");
  await sendWebhook({ id: "evt_3", type: "checkout.session.async_payment_succeeded", data: { object: { ...obj, payment_status: "paid" } } });
  assert.equal((await api(`/api/orders/${id}`, { cookie })).body.order.status, "paid");
});

test("subscription events update billing status", async () => {
  const { user, cookie } = signIn("server@example.com");
  const id = makeOrder(user.id, "mcserver");
  await sendWebhook({ id: "evt_4", type: "checkout.session.completed", data: { object: {
    mode: "subscription", payment_status: "paid", subscription: "sub_123", metadata: { order_id: String(id) } } } });
  let o = (await api(`/api/orders/${id}`, { cookie })).body.order;
  assert.equal(o.subscriptionStatus, "active");
  await sendWebhook({ id: "evt_5", type: "invoice.payment_failed", data: { object: { parent: { subscription_details: { subscription: "sub_123" } } } } });
  assert.equal((await api(`/api/orders/${id}`, { cookie })).body.order.subscriptionStatus, "past_due");
  await sendWebhook({ id: "evt_6", type: "customer.subscription.deleted", data: { object: { id: "sub_123", status: "canceled", metadata: {} } } });
  o = (await api(`/api/orders/${id}`, { cookie })).body.order;
  assert.equal(o.subscriptionStatus, "canceled");
});

test("customers see only their own orders and can write a brief and messages", async () => {
  const a = signIn("a@example.com"), b = signIn("b@example.com");
  const id = makeOrder(a.user.id, "website", "paid");
  assert.equal((await api(`/api/orders/${id}`, { cookie: b.cookie })).status, 404);
  assert.equal((await api("/api/orders", { cookie: b.cookie })).body.orders.length, 0);
  const patched = await api(`/api/orders/${id}`, { method: "PATCH", body: { brief: "A site for my server" }, cookie: a.cookie });
  assert.equal(patched.body.order.brief, "A site for my server");
  const msg = await api(`/api/orders/${id}/messages`, { method: "POST", body: { body: "Hi!" }, cookie: a.cookie });
  assert.equal(msg.body.messages[0].fromOwner, false);
});

test("only the site owner can manage orders", async () => {
  const cust = signIn("c@example.com"), owner = signIn("owner@example.com");
  const id = makeOrder(cust.user.id, "game", "paid");
  assert.equal((await api("/api/admin/orders", { cookie: cust.cookie })).status, 403);
  const list = await api("/api/admin/orders", { cookie: owner.cookie });
  assert.ok(list.body.orders.some(o => o.id === id && o.customer.email === "c@example.com"));
  const upd = await api(`/api/admin/orders/${id}`, { method: "PATCH", body: { status: "delivered", deliverableUrl: "https://example.com/game" }, cookie: owner.cookie });
  assert.equal(upd.body.order.status, "delivered");
  assert.equal((await api(`/api/admin/orders/${id}`, { method: "PATCH", body: { deliverableUrl: "javascript:alert(1)" }, cookie: owner.cookie })).status, 400);
  const reply = await api(`/api/orders/${id}/messages`, { method: "POST", body: { body: "Your game is live" }, cookie: owner.cookie });
  assert.equal(reply.body.messages.at(-1).fromOwner, true);
  assert.equal((await api(`/api/orders/${id}`, { method: "PATCH", body: { brief: "x" }, cookie: cust.cookie })).status, 409);
});

test("showcase listings need a paid slot and owner approval", async () => {
  const u = signIn("show@example.com"), owner = signIn("owner@example.com");
  const listing = { title: "My server", url: "https://play.example.com", description: "Survival" };
  assert.equal((await api("/api/showcase", { method: "POST", body: listing, cookie: u.cookie })).status, 402);
  makeOrder(u.user.id, "showcase", "paid");
  assert.equal((await api("/api/showcase", { method: "POST", body: listing, cookie: u.cookie })).status, 201);
  assert.equal((await api("/api/showcase", { method: "POST", body: listing, cookie: u.cookie })).status, 402);
  assert.equal((await api("/api/showcase")).body.listings.length, 0);
  const pending = (await api("/api/admin/showcase", { cookie: owner.cookie })).body.listings[0];
  await api(`/api/admin/showcase/${pending.id}`, { method: "PATCH", body: { status: "approved" }, cookie: owner.cookie });
  assert.equal((await api("/api/showcase")).body.listings[0].title, "My server");
});

test("mods made while signed in are saved to the account", async () => {
  const { cookie } = signIn("modder@example.com");
  const r = await fetch(url("/api/mod/zip"), { method: "POST", headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ name: "Ruby Tools", author: "Ana", description: "Rubies", items: ["Ruby"] }) });
  assert.equal(r.headers.get("content-type"), "application/zip");
  await r.arrayBuffer();
  const saved = (await api("/api/creations", { cookie })).body.creations[0];
  assert.equal(saved.name, "Ruby Tools");
  assert.equal(saved.kind, "mod");
});

test("deleting an account keeps orders but removes the user", async () => {
  const { user, cookie } = signIn("leaving@example.com");
  const id = makeOrder(user.id, "discord", "delivered");
  db.prepare("UPDATE orders SET brief = 'secret plans' WHERE id = ?").run(id);
  await api(`/api/orders/${id}/messages`, { method: "POST", body: { body: "hello" }, cookie });
  assert.equal((await api("/api/me", { method: "DELETE", body: {}, cookie })).status, 200);
  assert.equal((await api("/api/me", { cookie })).body.user, null);
  const kept = db.prepare("SELECT user_id, brief FROM orders WHERE id = ?").get(id);
  assert.equal(kept.user_id, null);
  assert.equal(kept.brief, "");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM order_messages WHERE order_id = ?").get(id).n, 0);
});

test("accounts with an active subscription must cancel first", async () => {
  const { user, cookie } = signIn("subbed@example.com");
  const id = makeOrder(user.id, "mcserver", "paid");
  db.prepare("UPDATE orders SET subscription_status = 'active' WHERE id = ?").run(id);
  assert.equal((await api("/api/me", { method: "DELETE", body: {}, cookie })).status, 409);
});

test("security headers allow Google sign-in", async () => {
  const r = await fetch(url("/"));
  assert.match(r.headers.get("content-security-policy"), /accounts\.google\.com\/gsi\/client/);
  assert.equal(r.headers.get("cross-origin-opener-policy"), "same-origin-allow-popups");
});
