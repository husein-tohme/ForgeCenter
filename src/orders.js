// Orders, Stripe Checkout, billing portal and the owner's order tools.
import express from "express";
import { db, now } from "./db.js";
import { catalog, modeOf, isAdultOnly } from "./catalog.js";
import { isAdmin, isAdult, requireAdmin, requireUser } from "./auth.js";
import { rateLimit } from "./limit.js";
import { notify } from "./email.js";
import { getStripe, ensureCustomer, baseUrl, CHECKOUT_LABELS } from "./stripe.js";
import { createServiceForOrder, serviceForOrder, publicService } from "./services.js";

export const STATUSES = ["awaiting_payment", "paid", "in_progress", "delivered", "payment_failed", "expired", "canceled"];
const PAID = "('paid', 'in_progress', 'delivered')";
const getOrder = id => db.prepare("SELECT * FROM orders WHERE id = ?").get(Number(id));

function serialize(o, { withCustomer = false } = {}) {
  const out = {
    id: o.id, product: o.product, name: catalog[o.product]?.name ?? o.product,
    amount: o.amount, monthly: o.monthly, status: o.status, subscriptionStatus: o.subscription_status,
    brief: o.brief, deliverableUrl: o.deliverable_url, paidWith: o.paid_with ?? "card",
    createdAt: o.created_at, updatedAt: o.updated_at,
  };
  if (withCustomer) out.customer = o.user_name ? { name: o.user_name, email: o.user_email, phone: o.user_phone } : null;
  return out;
}

const messagesFor = orderId => db.prepare(
  "SELECT id, from_admin AS fromOwner, body, created_at AS createdAt FROM order_messages WHERE order_id = ? ORDER BY id"
).all(orderId).map(m => ({ ...m, fromOwner: !!m.fromOwner }));

// ---------- Fulfillment (shared by webhooks and the return-page sync) ----------
export function fulfillCheckout(session) {
  if (session.payment_status === "unpaid") return; // delayed payment methods settle later
  const orderId = Number(session.metadata?.order_id || session.client_reference_id);
  const order = getOrder(orderId);
  if (!order || !["awaiting_payment", "payment_failed", "expired"].includes(order.status)) return;
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
  db.prepare(`UPDATE orders SET status = 'paid', paid_at = COALESCE(paid_at, ?),
      subscription_status = CASE WHEN ? THEN COALESCE(subscription_status, 'active') ELSE subscription_status END,
      stripe_subscription_id = COALESCE(?, stripe_subscription_id), updated_at = ? WHERE id = ?`)
    .run(now(), session.mode === "subscription" ? 1 : 0, subId, now(), orderId);
  afterPayment(getOrder(orderId));
}

// Everything that follows a payment, whether by card or from the wallet.
export function afterPayment(order) {
  createServiceForOrder(order);
  notify.orderPaid(order);
}

function setCheckoutStatus(session, status) {
  const orderId = Number(session.metadata?.order_id || session.client_reference_id);
  db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = 'awaiting_payment'")
    .run(status, now(), orderId);
}

const SUB_STATUS = {
  active: "active", trialing: "active", past_due: "past_due", unpaid: "past_due", incomplete: "past_due",
  canceled: "canceled", incomplete_expired: "canceled", paused: "paused",
};

function setSubscriptionStatus(subId, status, orderIdHint) {
  const r = db.prepare("UPDATE orders SET subscription_status = ?, updated_at = ? WHERE stripe_subscription_id = ?")
    .run(status, now(), subId);
  if (!r.changes && orderIdHint) {
    db.prepare("UPDATE orders SET subscription_status = ?, stripe_subscription_id = ?, updated_at = ? WHERE id = ?")
      .run(status, subId, now(), Number(orderIdHint));
  }
}

const invoiceSubId = inv => inv.parent?.subscription_details?.subscription ?? inv.subscription ?? null;

// Checkout Sessions for shop orders, and subscription billing.
export function handleOrderEvent(event) {
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return fulfillCheckout(obj);
    case "checkout.session.async_payment_failed":
      return setCheckoutStatus(obj, "payment_failed");
    case "checkout.session.expired":
      return setCheckoutStatus(obj, "expired");
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return setSubscriptionStatus(obj.id, SUB_STATUS[obj.status] ?? obj.status, obj.metadata?.order_id);
    case "invoice.paid": {
      const sub = invoiceSubId(obj);
      return sub && setSubscriptionStatus(sub, "active");
    }
    case "invoice.payment_failed": {
      const sub = invoiceSubId(obj);
      if (!sub) return;
      setSubscriptionStatus(sub, "past_due");
      const order = db.prepare("SELECT * FROM orders WHERE stripe_subscription_id = ?").get(sub);
      if (order) notify.paymentFailed(order);
      return;
    }
  }
}

// ---------- Customer routes ----------
export const ordersRouter = express.Router();

ordersRouter.post("/checkout", requireUser, rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  const key = req.body?.product;
  const item = catalog[key];
  if (!item) return res.status(400).json({ error: "That product doesn't exist." });
  // Bought through its own page, which ties the order to what it's for (a game launch to its game).
  if (item.ownFlow) return res.status(400).json({ error: "Launch a game from My games at /my-games: each game has its own Launch button." });
  if (isAdultOnly(key) && !isAdult(req.user)) return res.status(403).json({ error: `Confirm you're an adult to buy a ${item.name.toLowerCase()}.`, needs: "adult" });
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: "Payments aren't set up yet." });

  let orderId;
  try {
    const customer = await ensureCustomer(stripe, req.user);
    const t = now();
    orderId = Number(db.prepare(`INSERT INTO orders (user_id, product, amount, monthly, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'awaiting_payment', ?, ?)`).run(req.user.id, key, item.price ?? 0, item.monthly ?? 0, t, t).lastInsertRowid);

    const line_items = [];
    if (item.price) line_items.push({ quantity: 1, price_data: {
      currency: "usd", unit_amount: item.price, product_data: { name: item.name, description: item.desc } } });
    if (item.monthly) line_items.push({ quantity: 1, price_data: {
      currency: "usd", unit_amount: item.monthly, recurring: { interval: "month" }, product_data: { name: item.monthlyName } } });

    const mode = modeOf(item);
    const metadata = { kind: "order", order_id: String(orderId) };
    const session = await stripe.checkout.sessions.create({
      mode, line_items, customer,
      client_reference_id: String(orderId), metadata,
      ...(mode === "subscription" ? { subscription_data: { metadata } } : { payment_intent_data: { metadata } }),
      success_url: `${baseUrl(req)}/account.html?order=${orderId}&paid=1`,
      cancel_url: `${baseUrl(req)}/#shop`,
      integration_identifier: CHECKOUT_LABELS.shop,
    });
    db.prepare("UPDATE orders SET stripe_session_id = ? WHERE id = ?").run(session.id, orderId);
    res.json({ url: session.url, orderId });
  } catch (e) {
    if (orderId) db.prepare("DELETE FROM orders WHERE id = ?").run(orderId);
    console.error("Checkout failed", e.message);
    res.status(502).json({ error: "Checkout couldn't start. Try again in a moment." });
  }
});

ordersRouter.post("/billing-portal", requireUser, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: "Payments aren't set up yet." });
  if (!req.user.stripe_customer_id) return res.status(400).json({ error: "You don't have any billing yet." });
  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: req.user.stripe_customer_id, return_url: `${baseUrl(req)}/account.html`,
    });
    res.json({ url: portal.url });
  } catch (e) {
    console.error("Billing portal failed", e.message);
    res.status(502).json({ error: "Billing couldn't open. Try again in a moment." });
  }
});

ordersRouter.get("/orders", requireUser, (req, res) => {
  const rows = db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC").all(req.user.id);
  res.json({ orders: rows.map(o => serialize(o)) });
});

// Owner of the order, or the site owner, may view it.
function loadOwnOrder(req, res, next) {
  const order = getOrder(req.params.id);
  if (!order || (order.user_id !== req.user.id && !isAdmin(req.user))) {
    return res.status(404).json({ error: "Order not found." });
  }
  req.order = order;
  next();
}

ordersRouter.get("/orders/:id", requireUser, loadOwnOrder, async (req, res) => {
  let order = req.order;
  // Catch up if the webhook hasn't arrived yet when the customer lands back on the site.
  const stripe = getStripe();
  if (order.status === "awaiting_payment" && order.stripe_session_id && stripe) {
    try {
      const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
      if (session.status === "complete") fulfillCheckout(session);
      else if (session.status === "expired") setCheckoutStatus(session, "expired");
      order = getOrder(order.id);
    } catch (e) { console.error("Order sync failed", e.message); }
  }
  res.json({ order: { ...serialize(order), messages: messagesFor(order.id),
    service: publicService(serviceForOrder(order.id), { owner: isAdmin(req.user) }) } });
});

ordersRouter.patch("/orders/:id", requireUser, loadOwnOrder, (req, res) => {
  if (req.order.user_id !== req.user.id) return res.status(403).json({ error: "Only the customer can edit the brief." });
  if (["delivered", "canceled"].includes(req.order.status)) return res.status(409).json({ error: "This order is finished, so the brief is locked." });
  const brief = String(req.body?.brief ?? "").slice(0, 5000);
  db.prepare("UPDATE orders SET brief = ?, updated_at = ? WHERE id = ?").run(brief, now(), req.order.id);
  res.json({ order: serialize(getOrder(req.order.id)) });
});

ordersRouter.post("/orders/:id/messages", requireUser, loadOwnOrder, rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  const body = String(req.body?.body ?? "").trim().slice(0, 4000);
  if (!body) return res.status(400).json({ error: "Write a message first." });
  const fromOwner = req.order.user_id !== req.user.id ? 1 : 0;
  db.prepare("INSERT INTO order_messages (order_id, from_admin, body, created_at) VALUES (?, ?, ?, ?)")
    .run(req.order.id, fromOwner, body, now());
  notify.newMessage(req.order, !!fromOwner, body);
  res.json({ messages: messagesFor(req.order.id) });
});

// ---------- Site owner routes ----------
export const adminOrdersRouter = express.Router();
adminOrdersRouter.use(requireUser, requireAdmin);

// The customer wrote last, so they're waiting on the owner.
const AWAITING_REPLY = `(SELECT from_admin FROM order_messages m WHERE m.order_id = o.id ORDER BY m.id DESC LIMIT 1) = 0`;
// Owner-panel filters beyond plain statuses.
const SPECIAL_FILTERS = {
  awaiting_reply: AWAITING_REPLY,
  setup_failed: "EXISTS (SELECT 1 FROM services s WHERE s.order_id = o.id AND s.state = 'failed')",
  past_due: "o.subscription_status = 'past_due'",
};

adminOrdersRouter.get("/orders", (req, res) => {
  const filter = String(req.query.status ?? "");
  const where = SPECIAL_FILTERS[filter]
    ?? (STATUSES.includes(filter) ? "o.status = ?" : "o.status NOT IN ('awaiting_payment', 'expired')");
  const rows = db.prepare(`SELECT o.*, u.email AS user_email, u.phone AS user_phone, u.name AS user_name,
      (SELECT COUNT(*) FROM order_messages m WHERE m.order_id = o.id) AS message_count
    FROM orders o LEFT JOIN users u ON u.id = o.user_id
    WHERE ${where} ORDER BY o.id DESC LIMIT 200`).all(...(STATUSES.includes(filter) ? [filter] : []));
  res.json({ orders: rows.map(o => ({ ...serialize(o, { withCustomer: true }), messageCount: o.message_count })) });
});

// Numbers for the top of the owner panel. Renewal payments live in Stripe, so sales
// here are new orders; recurring revenue is the monthly total of active subscriptions.
adminOrdersRouter.get("/overview", (_req, res) => {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString();
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const sales = (from, to) => one(`SELECT COALESCE(SUM(amount + monthly), 0) AS cents, COUNT(*) AS n FROM orders
    WHERE status IN ${PAID} AND created_at >= ? AND created_at < ?`, from, to);
  const thisMonth = sales(monthStart, "9999");
  const lastMonth = sales(lastMonthStart, monthStart);
  res.json({
    month: monthStart.slice(0, 7),
    sales: { cents: thisMonth.cents, orders: thisMonth.n, lastMonthCents: lastMonth.cents },
    recurringCents: one("SELECT COALESCE(SUM(monthly), 0) AS c FROM orders WHERE subscription_status = 'active'").c,
    activeServers: one("SELECT COUNT(*) AS n FROM services WHERE kind = 'minecraft' AND state = 'active'").n,
    activeBots: one("SELECT COUNT(*) AS n FROM services WHERE kind = 'discord_bot' AND state = 'active'").n,
    customers: one("SELECT COUNT(*) AS n FROM users").n,
    newCustomers: one("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", monthStart).n,
    attention: {
      notStarted: one("SELECT COUNT(*) AS n FROM orders WHERE status = 'paid'").n,
      awaitingReply: one(`SELECT COUNT(*) AS n FROM orders o WHERE ${AWAITING_REPLY}`).n,
      setupFailed: one("SELECT COUNT(*) AS n FROM services WHERE state = 'failed'").n,
      pastDue: one("SELECT COUNT(*) AS n FROM orders WHERE subscription_status = 'past_due'").n,
      pendingListings: one("SELECT COUNT(*) AS n FROM showcase WHERE status = 'pending'").n,
      ticketsWaiting: one("SELECT COUNT(*) AS n FROM tickets WHERE status = 'waiting'").n,
    },
    walletCents: one("SELECT COALESCE(SUM(amount), 0) AS c FROM wallet_entries WHERE user_id IS NOT NULL").c,
  });
});

adminOrdersRouter.patch("/orders/:id", (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  const { status, deliverableUrl } = req.body ?? {};
  if (status !== undefined && !STATUSES.includes(status)) return res.status(400).json({ error: "Unknown status." });
  if (deliverableUrl && !/^https?:\/\/\S+$/i.test(deliverableUrl)) return res.status(400).json({ error: "The delivery link must start with http:// or https://." });
  db.prepare(`UPDATE orders SET status = COALESCE(?, status),
      deliverable_url = CASE WHEN ? THEN ? ELSE deliverable_url END, updated_at = ? WHERE id = ?`)
    .run(status ?? null, deliverableUrl !== undefined ? 1 : 0, deliverableUrl || null, now(), order.id);
  const updated = getOrder(order.id);
  if (updated.status !== order.status) notify.statusChanged(updated);
  res.json({ order: serialize(updated) });
});

export const paidOrderCount = (userId, product) =>
  db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND product = ? AND status IN ${PAID}`).get(userId, product).n;
