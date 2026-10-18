// Orbs, ForgeCenter's own currency (like Minecraft XP orbs), kept in the wallet ledger.
// 1 orb = 1 US cent, so every amount here is in cents and is also the orb count.
// People buy orb packs by card and spend orbs on one-time items and on AI messages
// past the free daily allowance (src/tutor.js). It's closed-loop store credit: orbs
// can't be withdrawn, sold or sent to someone else, which keeps it store credit rather
// than a money service. Unused orb packs can be refunded to the card they came from
// (from the Stripe Dashboard), and the owner can refund orders as orbs.
import express from "express";
import { db, now, walletBalance } from "./db.js";
import { catalog, isAdultOnly, walletPayable, orbs, usd } from "./catalog.js";
import { isAdult, requireAdmin, requireUser } from "./auth.js";
import { rateLimit } from "./limit.js";
import { notify } from "./email.js";
import { getStripe, ensureCustomer, baseUrl, CHECKOUT_LABELS, checkoutKind } from "./stripe.js";
import { afterPayment } from "./orders.js";
import { aiOrbsOn, ORBS_PER_AI_UNIT, FREE_DAILY, AI_PLAN_DAILY } from "./tutor.js";

// Cents, which are orbs. The balance cap keeps this small-purchase credit, not a place to park money.
export const WALLET_LIMITS = { minTopup: 500, maxTopup: 50000, maxBalance: 200000 };
const MAX_OWNER_CREDIT = 50000;

// Runs fn inside one write transaction, so balance checks and entries can't interleave.
// Exported for the other place that spends orbs: AI messages (spendAllowance in tutor.js).
export function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try { const out = fn(); db.exec("COMMIT"); return out; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}

export function addEntry({ userId, amount, kind, orderId = null, topupId = null, ref = null, note = "" }) {
  return db.prepare(`INSERT OR IGNORE INTO wallet_entries (user_id, amount, kind, order_id, topup_id, ref, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(userId, amount, kind, orderId, topupId, ref, note, now()).changes > 0;
}

// Money still on its way in, so a burst of top-ups can't pass the balance cap.
const pendingTopups = userId => db.prepare(`SELECT COALESCE(SUM(amount), 0) AS c FROM wallet_topups
  WHERE user_id = ? AND status = 'awaiting_payment' AND created_at >= ?`)
  .get(userId, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).c;

// ---------- Stripe events ----------
function creditTopup(session) {
  if (session.payment_status === "unpaid") return; // bank payments settle later
  const topup = db.prepare("SELECT * FROM wallet_topups WHERE stripe_session_id = ?").get(session.id);
  if (!topup) return;
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  transaction(() => {
    // Late success after an expiry or failure still counts: the money was taken.
    const r = db.prepare(`UPDATE wallet_topups SET status = 'paid', stripe_payment_intent = COALESCE(?, stripe_payment_intent),
      updated_at = ? WHERE id = ? AND status != 'paid'`).run(pi, now(), topup.id);
    if (r.changes) addEntry({ userId: topup.user_id, amount: topup.amount, kind: "topup", topupId: topup.id, ref: `topup:${session.id}` });
  });
}

const setTopupStatus = (session, status) => db.prepare(`UPDATE wallet_topups SET status = ?, updated_at = ?
  WHERE stripe_session_id = ? AND status = 'awaiting_payment'`).run(status, now(), session.id);

const piOf = obj => (typeof obj.payment_intent === "string" ? obj.payment_intent : obj.payment_intent?.id);
const topupFor = obj => { const pi = piOf(obj); return pi ? db.prepare("SELECT * FROM wallet_topups WHERE stripe_payment_intent = ?").get(pi) : null; };

// A top-up refunded from the Stripe Dashboard takes the same amount out of the wallet.
// The charge can be in another currency (Adaptive Pricing), so work in shares of it.
function refundTopup(charge) {
  const topup = topupFor(charge);
  if (!topup) return;
  const share = charge.refunded || !charge.amount ? 1 : Math.min(1, charge.amount_refunded / charge.amount);
  transaction(() => {
    const fresh = db.prepare("SELECT refunded FROM wallet_topups WHERE id = ?").get(topup.id);
    const delta = Math.round(topup.amount * share) - fresh.refunded;
    if (delta <= 0) return;
    db.prepare("UPDATE wallet_topups SET refunded = refunded + ?, updated_at = ? WHERE id = ?").run(delta, now(), topup.id);
    addEntry({ userId: topup.user_id, amount: -delta, kind: "topup_refund", topupId: topup.id, ref: `refund:${charge.id}:${charge.amount_refunded}` });
  });
}

// A chargeback on a top-up takes its credit back while the bank decides; winning the
// dispute gives it back. Either way the owner hears about it.
function disputeTopup(dispute, won) {
  const topup = topupFor(dispute);
  if (!topup) return;
  const held = topup.amount - topup.refunded;
  if (held <= 0) return;
  const added = won
    ? addEntry({ userId: topup.user_id, amount: held, kind: "dispute", topupId: topup.id, ref: `dispute-won:${dispute.id}`, note: "Card dispute closed in your favour" })
    : addEntry({ userId: topup.user_id, amount: -held, kind: "dispute", topupId: topup.id, ref: `dispute:${dispute.id}`, note: "Card dispute opened with your bank" });
  if (added) notify.topupDisputed(topup, won);
}

export function handleWalletEvent(event) {
  const obj = event.data.object;
  if (event.type === "charge.refunded") return refundTopup(obj);
  if (event.type === "charge.dispute.created") return disputeTopup(obj, false);
  if (event.type === "charge.dispute.closed") {
    // Only give credit back if it was taken for this dispute in the first place.
    const taken = db.prepare("SELECT 1 FROM wallet_entries WHERE ref = ?").get(`dispute:${obj.id}`);
    return obj.status === "won" && taken ? disputeTopup(obj, true) : undefined;
  }
  if (checkoutKind(obj) !== "wallet_topup") return;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return creditTopup(obj);
    case "checkout.session.async_payment_failed":
      return setTopupStatus(obj, "payment_failed");
    case "checkout.session.expired":
      return setTopupStatus(obj, "expired");
  }
}

// ---------- Customer routes ----------
export const walletRouter = express.Router();

const publicEntry = e => ({
  id: e.id, amount: e.amount, kind: e.kind, note: e.note, orderId: e.order_id, createdAt: e.created_at,
  product: e.product ? catalog[e.product]?.name ?? e.product : null,
});

walletRouter.get("/", requireUser, async (req, res) => {
  // Catch up on top-ups whose webhook hasn't arrived yet (people land back here first).
  const stripe = getStripe();
  const waiting = db.prepare(`SELECT * FROM wallet_topups WHERE user_id = ? AND status = 'awaiting_payment'
    AND stripe_session_id IS NOT NULL ORDER BY id DESC LIMIT 3`).all(req.user.id);
  for (const t of stripe ? waiting : []) {
    try {
      const session = await stripe.checkout.sessions.retrieve(t.stripe_session_id);
      if (session.status === "complete") creditTopup(session);
      else if (session.status === "expired") setTopupStatus(session, "expired");
    } catch (e) { console.error("Top-up sync failed", e.message); }
  }
  const entries = db.prepare(`SELECT w.*, o.product FROM wallet_entries w LEFT JOIN orders o ON o.id = w.order_id
    WHERE w.user_id = ? ORDER BY w.id DESC LIMIT 50`).all(req.user.id);
  const pending = db.prepare(`SELECT id, amount, status, created_at AS createdAt FROM wallet_topups
    WHERE user_id = ? AND status = 'awaiting_payment' ORDER BY id DESC LIMIT 5`).all(req.user.id);
  res.json({ balance: walletBalance(req.user.id), entries: entries.map(publicEntry), pending, limits: WALLET_LIMITS, available: !!stripe,
    aiOrbs: aiOrbsOn(req.user.id), orbsPerAiUnit: ORBS_PER_AI_UNIT });
});

// Public facts for the orbs page, so signed-out visitors see the same numbers.
walletRouter.get("/info", (_req, res) => {
  res.json({ limits: WALLET_LIMITS, orbsPerAiUnit: ORBS_PER_AI_UNIT, freeDaily: FREE_DAILY, aiPlanDaily: AI_PLAN_DAILY, available: !!getStripe() });
});

// "When my free AI messages run out, use orbs" (see spendAllowance in tutor.js).
walletRouter.patch("/ai-orbs", requireUser, (req, res) => {
  if (typeof req.body?.on !== "boolean") return res.status(400).json({ error: "Send on: true or on: false." });
  db.prepare("UPDATE users SET ai_orbs = ? WHERE id = ?").run(req.body.on ? 1 : 0, req.user.id);
  res.json({ aiOrbs: req.body.on, orbsPerAiUnit: ORBS_PER_AI_UNIT });
});

walletRouter.post("/topup", requireUser, rateLimit({ windowMs: 60_000, max: 5 }), async (req, res) => {
  const amount = Number(req.body?.amount);
  const { minTopup, maxTopup, maxBalance } = WALLET_LIMITS;
  if (!Number.isInteger(amount) || amount % 100 || amount < minTopup || amount > maxTopup) {
    return res.status(400).json({ error: `Choose a number of orbs in hundreds, from ${orbs(minTopup)} to ${orbs(maxTopup)} (${usd(minTopup)} to ${usd(maxTopup)}).` });
  }
  const room = maxBalance - walletBalance(req.user.id) - pendingTopups(req.user.id);
  if (amount > room) {
    return res.status(400).json({ error: room >= minTopup
      ? `You can hold up to ${orbs(maxBalance)}, so you can buy ${orbs(Math.floor(room / 100) * 100)} at most right now.`
      : `You already have as many orbs as an account can hold (${orbs(maxBalance)}). Spend some before buying more.` });
  }
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: "Payments aren't set up yet." });

  const t = now();
  const id = Number(db.prepare(`INSERT INTO wallet_topups (user_id, amount, status, created_at, updated_at)
    VALUES (?, ?, 'awaiting_payment', ?, ?)`).run(req.user.id, amount, t, t).lastInsertRowid);
  try {
    const metadata = { kind: "wallet_topup", topup_id: String(id), user_id: String(req.user.id) };
    const session = await stripe.checkout.sessions.create({
      mode: "payment", customer: await ensureCustomer(stripe, req.user),
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: amount, product_data: {
        name: `${amount.toLocaleString("en-US")} ForgeCenter orbs`,
        description: "ForgeCenter's own currency, 1 orb for each cent. Orbs never expire, and they can't be withdrawn, sold or sent to other people." } } }],
      metadata, payment_intent_data: { metadata },
      success_url: `${baseUrl(req)}/account?topup=${id}#wallet`, cancel_url: `${baseUrl(req)}/account#wallet`,
      // Just over Stripe's 30-minute minimum, so an abandoned checkout clears quickly.
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      integration_identifier: CHECKOUT_LABELS.wallet,
    });
    db.prepare("UPDATE wallet_topups SET stripe_session_id = ? WHERE id = ?").run(session.id, id);
    res.json({ url: session.url });
  } catch (e) {
    db.prepare("DELETE FROM wallet_topups WHERE id = ?").run(id);
    console.error("Top-up checkout failed", e.message);
    res.status(502).json({ error: "Checkout couldn't start. Try again in a moment." });
  }
});

walletRouter.post("/pay", requireUser, rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
  const key = req.body?.product;
  const item = catalog[key];
  if (!item) return res.status(400).json({ error: "That product doesn't exist." });
  if (!walletPayable(item)) return res.status(400).json({ error: "Monthly plans are paid by card so they can renew, so they can't be paid with orbs. Use Go to checkout instead." });
  if (isAdultOnly(key) && !isAdult(req.user)) return res.status(403).json({ error: `Confirm you're an adult to buy a ${item.name.toLowerCase()}.`, needs: "adult" });

  const orderId = transaction(() => {
    const balance = walletBalance(req.user.id);
    if (balance < item.price) return null;
    const t = now();
    const id = Number(db.prepare(`INSERT INTO orders (user_id, product, amount, monthly, status, paid_with, paid_at, created_at, updated_at)
      VALUES (?, ?, ?, 0, 'paid', 'wallet', ?, ?, ?)`).run(req.user.id, key, item.price, t, t, t).lastInsertRowid);
    addEntry({ userId: req.user.id, amount: -item.price, kind: "purchase", orderId: id, ref: `order:${id}` });
    return id;
  });
  if (!orderId) {
    const short = item.price - walletBalance(req.user.id);
    return res.status(402).json({ error: `You need ${short.toLocaleString("en-US")} more ${short === 1 ? "orb" : "orbs"}. Buy orbs at /orbs, or pay by card.` });
  }
  afterPayment(db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId));
  res.json({ orderId, balance: walletBalance(req.user.id) });
});

// ---------- Owner routes ----------
export const adminWalletRouter = express.Router();
adminWalletRouter.use(requireUser, requireAdmin);


// Refund part or all of an order as orbs. Card refunds go through the Stripe Dashboard.
adminWalletRouter.post("/orders/:id/wallet-refund", (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(Number(req.params.id));
  if (!order) return res.status(404).json({ error: "Order not found." });
  if (!order.user_id) return res.status(409).json({ error: "This customer deleted their account, so there's nowhere to refund orbs to. Refund the card in the Stripe Dashboard instead." });
  // paid_at, not the status: the owner can mark any order canceled, paid or not.
  if (!order.paid_at) return res.status(409).json({ error: "This order was never paid, so there's nothing to refund." });
  const amount = Number(req.body?.amount);
  const refunded = db.prepare("SELECT COALESCE(SUM(amount), 0) AS c FROM wallet_entries WHERE order_id = ? AND kind = 'refund'").get(order.id).c;
  const left = order.amount + order.monthly - refunded;
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: "Enter how many orbs to refund." });
  if (amount > left) return res.status(400).json({ error: `At most ${orbs(left)} (${usd(left)}) of this order can still be refunded.` });
  addEntry({ userId: order.user_id, amount, kind: "refund", orderId: order.id, note: `Refund for order ${order.id}` });
  notify.walletCredited(order.user_id, amount, `a refund for order ${order.id}`);
  res.json({ refunded: refunded + amount, balance: walletBalance(order.user_id) });
});

// Goodwill orbs, for example after downtime.
adminWalletRouter.post("/users/:id/wallet-credit", (req, res) => {
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(Number(req.params.id));
  if (!user) return res.status(404).json({ error: "Account not found." });
  const amount = Number(req.body?.amount);
  const note = String(req.body?.note ?? "").trim().slice(0, 140);
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_OWNER_CREDIT) {
    return res.status(400).json({ error: `Enter a number of orbs up to ${orbs(MAX_OWNER_CREDIT)}.` });
  }
  if (!note) return res.status(400).json({ error: "Add a short note so the customer knows what the orbs are for." });
  addEntry({ userId: user.id, amount, kind: "credit", note });
  notify.walletCredited(user.id, amount, note);
  res.json({ balance: walletBalance(user.id) });
});
