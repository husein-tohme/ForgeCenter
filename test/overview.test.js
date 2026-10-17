import { test } from "node:test";
import assert from "node:assert/strict";
import { api, db, signIn } from "./helpers.js";

const order = (userId, product, { status = "paid", amount = 0, monthly = 0, sub = null, at = new Date().toISOString() } = {}) =>
  Number(db.prepare(`INSERT INTO orders (user_id, product, amount, monthly, status, subscription_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(userId, product, amount, monthly, status, sub, at, at).lastInsertRowid);
const service = (orderId, kind, state) =>
  db.prepare("INSERT INTO services (order_id, kind, state, created_at, updated_at) VALUES (?, ?, ?, 'now', 'now')").run(orderId, kind, state);

test("the owner overview adds up sales, recurring revenue and what needs attention", async () => {
  const owner = signIn("owner@example.com");
  const c = signIn("buyer@example.com");
  const now = new Date();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)).toISOString();

  order(c.user.id, "website", { amount: 100000, monthly: 200, sub: "active", status: "in_progress" });
  const server = order(c.user.id, "mcserver", { monthly: 10000, sub: "active", status: "delivered" });
  service(server, "minecraft", "active");
  const failed = order(c.user.id, "mcserver", { monthly: 10000, sub: "past_due" });
  service(failed, "minecraft", "failed");
  order(c.user.id, "discord", { amount: 10000, status: "awaiting_payment" }); // not paid: not counted
  order(c.user.id, "ai", { amount: 10000, status: "delivered", at: lastMonth });
  const chatty = order(c.user.id, "game", { amount: 1000000, status: "in_progress" });
  db.prepare("INSERT INTO order_messages (order_id, from_admin, body, created_at) VALUES (?, 0, 'Any news?', 'now')").run(chatty);

  const r = await api("/api/admin/overview", { cookie: owner.cookie });
  assert.equal(r.status, 200);
  const o = r.body;
  // website 1000+2, server 100, failed server 100 (paid), game 10000 this month
  assert.deepEqual(o.sales, { cents: 100200 + 10000 + 10000 + 1000000, orders: 4, lastMonthCents: 10000 });
  assert.equal(o.recurringCents, 200 + 10000);
  assert.equal(o.activeServers, 1);
  assert.deepEqual(o.attention, { notStarted: 1, awaitingReply: 1, setupFailed: 1, pastDue: 1, pendingListings: 0, ticketsWaiting: 0, reportsOpen: 0 });
  assert.equal(o.walletCents, 0);
  assert.equal(o.donationsCents, 0); // donations are counted separately from sales

  assert.equal((await api("/api/admin/overview", { cookie: c.cookie })).status, 403);
});

test("owner filters find orders waiting for a reply, failed setups and overdue payments", async () => {
  const owner = signIn("owner@example.com");
  const ids = (await Promise.all(["awaiting_reply", "setup_failed", "past_due"].map(f =>
    api(`/api/admin/orders?status=${f}`, { cookie: owner.cookie })))).map(r => r.body.orders.map(x => x.product));
  assert.deepEqual(ids, [["game"], ["mcserver"], ["mcserver"]]);
  // An unknown filter falls back to the normal list, never to raw input.
  const weird = await api("/api/admin/orders?status=1%3D1%20OR%201", { cookie: owner.cookie });
  assert.equal(weird.status, 200);
});
