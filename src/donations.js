// Donations: anyone can support ForgeCenter with a one-time gift, and signed-in
// people can give monthly (an account is how they cancel it, in Manage billing).
// They're gifts to the site owner's business, not purchases: nothing is delivered,
// they aren't tax-deductible (ForgeCenter isn't a charity) and they're only refunded
// when something went wrong. Like orders, a donation only counts once Stripe's
// webhook says the money arrived.
import express from "express";
import { db, now } from "./db.js";
import { requireUser } from "./auth.js";
import { rateLimit } from "./limit.js";
import { notify } from "./email.js";
import { getStripe, ensureCustomer, baseUrl, CHECKOUT_LABELS } from "./stripe.js";

// Cents, in whole dollars.
export const DONATION_LIMITS = { min: 100, max: 50000 };

db.exec(`
-- status: awaiting_payment, paid, payment_failed, expired, or canceled once a monthly
-- donation has ended. user_id is empty for visitors who gave without signing in, and
-- for donors who deleted their account (the record is kept for the books).
-- public_name: the donor ticked "Show my name on the supporters wall".
-- ends_at: when a cancelled monthly donation stops (the month already paid for runs out).
-- AUTOINCREMENT because Stripe metadata remembers donations by id.
CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,
  monthly INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  public_name INTEGER NOT NULL DEFAULT 0,
  stripe_session_id TEXT UNIQUE,
  stripe_subscription_id TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS donations_user ON donations(user_id);
CREATE INDEX IF NOT EXISTS donations_sub ON donations(stripe_subscription_id);

-- Money received: a one-time gift, or each month of a monthly one. ref (the Checkout
-- Session or the invoice) makes replayed Stripe events count once.
CREATE TABLE IF NOT EXISTS donation_payments (
  id INTEGER PRIMARY KEY,
  donation_id INTEGER NOT NULL REFERENCES donations(id),
  amount INTEGER NOT NULL,
  ref TEXT NOT NULL UNIQUE,
  paid_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS donation_payments_paid ON donation_payments(paid_at);
`);

// Shown on Stripe Checkout, next to the Donate button.
const SMALL_PRINT = "Donations are a gift to ForgeCenter, a small business, not a charity, so they aren't tax-deductible. They aren't refunded unless something went wrong, like being charged twice.";
const MONTHLY_PRINT = " This donation repeats every month until you cancel it in Manage billing on your ForgeCenter account. Cancelling stops future payments; months already given aren't refunded.";

const idOf = v => (typeof v === "string" ? v : v?.id ?? null);
const isoOf = seconds => (seconds ? new Date(seconds * 1000).toISOString() : null);
const getDonation = id => db.prepare("SELECT * FROM donations WHERE id = ?").get(Number(id));
const bySession = id => db.prepare("SELECT * FROM donations WHERE stripe_session_id = ?").get(id);
const bySubscription = id => (id ? db.prepare("SELECT * FROM donations WHERE stripe_subscription_id = ?").get(id) : undefined);
const invoiceSubId = inv => idOf(inv.parent?.subscription_details?.subscription ?? inv.subscription);
const invoiceMetadata = inv => inv.parent?.subscription_details?.metadata ?? inv.subscription_details?.metadata ?? null;

function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try { const out = fn(); db.exec("COMMIT"); return out; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}

const recordPayment = (donation, ref) => db.prepare(`INSERT OR IGNORE INTO donation_payments (donation_id, amount, ref, paid_at)
  VALUES (?, ?, ?, ?)`).run(donation.id, donation.amount, ref, now()).changes > 0;

// Donations received between two ISO times, first payments and monthly renewals alike.
export const donationsBetween = (from, to) => db.prepare(
  "SELECT COALESCE(SUM(amount), 0) AS c FROM donation_payments WHERE paid_at >= ? AND paid_at < ?").get(from, to).c;

// ---------- Stripe events ----------
// Shared by the webhook and the return page, so both follow the same rules.
function markPaid(session) {
  if (session.payment_status === "unpaid") return; // bank payments settle later
  const donation = bySession(session.id);
  if (!donation) return;
  // A monthly donation's first payment is its first invoice, so the invoice.paid event
  // for that invoice is the same money and must not count again.
  const ref = donation.monthly && session.invoice ? `invoice:${idOf(session.invoice)}` : `checkout:${session.id}`;
  const first = transaction(() => {
    // Late success after an expiry or failure still counts: the money was taken.
    const r = db.prepare(`UPDATE donations SET status = 'paid', paid_at = COALESCE(paid_at, ?),
        stripe_subscription_id = COALESCE(stripe_subscription_id, ?), updated_at = ?
      WHERE id = ? AND status IN ('awaiting_payment', 'payment_failed', 'expired')`)
      .run(now(), donation.monthly ? idOf(session.subscription) : null, now(), donation.id);
    if (r.changes) recordPayment(donation, ref);
    return r.changes > 0;
  });
  if (first) notify.donationThanks(getDonation(donation.id));
}

const setCheckoutStatus = (session, status) => db.prepare(`UPDATE donations SET status = ?, updated_at = ?
  WHERE stripe_session_id = ? AND status = 'awaiting_payment'`).run(status, now(), session.id);

// The donation a subscription belongs to. Its id is saved when Checkout completes;
// until then the metadata we put on the subscription says which donation it is.
function donationForSubscription(subId, metadata) {
  if (!subId) return null;
  const known = bySubscription(subId);
  if (known) return known;
  const hinted = metadata?.kind === "donation" && metadata.donation_id ? getDonation(metadata.donation_id) : null;
  if (!hinted?.monthly || hinted.stripe_subscription_id) return null;
  db.prepare("UPDATE donations SET stripe_subscription_id = ?, updated_at = ? WHERE id = ?").run(subId, now(), hinted.id);
  return getDonation(hinted.id);
}

// Cancelling in Manage billing stops the donation at the end of the month already paid
// for, so it stays active until then and ends when Stripe deletes the subscription.
function subscriptionChanged(sub, deleted) {
  const donation = donationForSubscription(sub.id, sub.metadata);
  if (!donation) return;
  if (deleted || ["canceled", "incomplete_expired"].includes(sub.status)) {
    db.prepare("UPDATE donations SET status = 'canceled', ends_at = ?, updated_at = ? WHERE id = ? AND status = 'paid'")
      .run(isoOf(sub.ended_at) ?? now(), now(), donation.id);
    return;
  }
  const endsAt = sub.cancel_at ?? (sub.cancel_at_period_end ? sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end : null);
  db.prepare("UPDATE donations SET ends_at = ?, updated_at = ? WHERE id = ? AND status = 'paid'").run(isoOf(endsAt), now(), donation.id);
}

function renewalPaid(invoice) {
  const donation = donationForSubscription(invoiceSubId(invoice), invoiceMetadata(invoice));
  // The first month was counted when Checkout completed.
  if (!donation?.paid_at || invoice.billing_reason === "subscription_create" || !invoice.amount_paid) return;
  recordPayment(donation, `invoice:${invoice.id}`);
}

// Subscription and invoice events for monthly donations, which webhooks.js sends here
// instead of to orders. The kind we put in the metadata decides; the id is a fallback.
export function isDonationEvent(event) {
  const obj = event.data.object;
  if (event.type.startsWith("customer.subscription.")) {
    return obj.metadata?.kind ? obj.metadata.kind === "donation" : !!bySubscription(obj.id);
  }
  if (event.type.startsWith("invoice.")) {
    const kind = invoiceMetadata(obj)?.kind;
    return kind ? kind === "donation" : !!bySubscription(invoiceSubId(obj));
  }
  return false;
}

export function handleDonationEvent(event) {
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return markPaid(obj);
    case "checkout.session.async_payment_failed":
      return setCheckoutStatus(obj, "payment_failed");
    case "checkout.session.expired":
      return setCheckoutStatus(obj, "expired");
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return subscriptionChanged(obj, event.type === "customer.subscription.deleted");
    case "invoice.paid":
      return renewalPaid(obj);
  }
}

// A monthly donation that will charge again. Its donor cancels it before deleting their
// account, so nobody is left paying with no account to stop it from.
export const hasActiveMonthly = userId => !!db.prepare(`SELECT 1 FROM donations
  WHERE user_id = ? AND monthly = 1 AND status = 'paid' AND ends_at IS NULL`).get(userId);

export function keepMonthlyDonors(req, res, next) {
  if (req.user && hasActiveMonthly(req.user.id)) {
    return res.status(409).json({ error: "Cancel your monthly donation in Manage billing before deleting your account." });
  }
  next();
}

// ---------- Routes ----------
export const donationsRouter = express.Router();

const publicDonation = d => ({
  id: d.id, amount: d.amount, monthly: !!d.monthly, status: d.status, showName: !!d.public_name,
  endsAt: d.ends_at, createdAt: d.created_at, paidAt: d.paid_at,
});
const onWall = userId => !!db.prepare(`SELECT 1 FROM donations WHERE user_id = ? AND public_name = 1
  AND paid_at IS NOT NULL AND status IN ('paid', 'canceled')`).get(userId);

// What the page needs before anyone has given: whether donations are on, and the limits.
donationsRouter.get("/options", (_req, res) => {
  res.json({ available: !!getStripe(), limits: DONATION_LIMITS });
});

// Recent donors who were signed in and chose to show their name: the display name
// only, never an amount or anything else. Visitors who gave without an account never
// appear, because there's no account to show or to change the choice from.
donationsRouter.get("/wall", (_req, res) => {
  const rows = db.prepare(`SELECT u.name, MAX(d.paid_at) AS last,
      EXISTS (SELECT 1 FROM donations m WHERE m.user_id = u.id AND m.monthly = 1 AND m.status = 'paid') AS monthly
    FROM donations d JOIN users u ON u.id = d.user_id
    WHERE d.public_name = 1 AND d.paid_at IS NOT NULL AND d.status IN ('paid', 'canceled')
      AND u.age_group IN ('teen', 'adult')
    GROUP BY u.id ORDER BY last DESC LIMIT 60`).all();
  res.json({ supporters: rows.map(r => ({ name: r.name, monthly: !!r.monthly })) });
});

donationsRouter.get("/mine", requireUser, (req, res) => {
  const rows = db.prepare(`SELECT * FROM donations WHERE user_id = ? AND paid_at IS NOT NULL
    ORDER BY id DESC LIMIT 20`).all(req.user.id);
  res.json({ donations: rows.map(publicDonation), onWall: onWall(req.user.id), activeMonthly: hasActiveMonthly(req.user.id) });
});

// Show or hide the person's name on the wall, for all their donations at once.
donationsRouter.patch("/mine", requireUser, (req, res) => {
  const show = req.body?.showName;
  if (typeof show !== "boolean") return res.status(400).json({ error: "Choose whether to show your name." });
  db.prepare("UPDATE donations SET public_name = ?, updated_at = ? WHERE user_id = ?").run(show ? 1 : 0, now(), req.user.id);
  res.json({ onWall: onWall(req.user.id) });
});

// The return page catches up if the webhook hasn't arrived yet, using the same rules
// as the webhook, so it never counts a payment Stripe hasn't confirmed.
donationsRouter.get("/:id(\\d+)", requireUser, async (req, res) => {
  let donation = getDonation(req.params.id);
  if (!donation || donation.user_id !== req.user.id) return res.status(404).json({ error: "Donation not found." });
  const stripe = getStripe();
  if (donation.status === "awaiting_payment" && donation.stripe_session_id && stripe) {
    try {
      const session = await stripe.checkout.sessions.retrieve(donation.stripe_session_id);
      if (session.status === "complete") markPaid(session);
      else if (session.status === "expired") setCheckoutStatus(session, "expired");
      donation = getDonation(donation.id);
    } catch (e) { console.error("Donation sync failed", e.message); }
  }
  res.json({ donation: publicDonation(donation) });
});

// Visitors can give once without an account. Signed-in people pass the usual account
// checks, and monthly donations need an account so they can be cancelled in Manage billing.
function donorChecks(req, res, next) {
  if (req.user) return requireUser(req, res, next);
  if (req.body?.monthly === true) return res.status(401).json({ error: "Sign in to give monthly, so you can cancel it yourself any time." });
  next();
}

donationsRouter.post("/", rateLimit({ windowMs: 60_000, max: 10 }), donorChecks, async (req, res) => {
  const amount = req.body?.amount;
  const monthly = req.body?.monthly === true;
  const { min, max } = DONATION_LIMITS;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount % 100 || amount < min || amount > max) {
    return res.status(400).json({ error: `Choose a whole-dollar amount from $${min / 100} to $${max / 100}.` });
  }
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: "Donations aren't switched on yet. Try again later." });

  const user = req.user ?? null;
  const t = now();
  const id = Number(db.prepare(`INSERT INTO donations (user_id, amount, monthly, status, public_name, created_at, updated_at)
    VALUES (?, ?, ?, 'awaiting_payment', ?, ?, ?)`)
    .run(user?.id ?? null, amount, monthly ? 1 : 0, user && req.body?.showName === true ? 1 : 0, t, t).lastInsertRowid);
  try {
    const metadata = { kind: "donation", donation_id: String(id) };
    // Signed-out visitors have no customer: Stripe asks for their email for the receipt.
    const customer = user ? await ensureCustomer(stripe, user) : undefined;
    const session = await stripe.checkout.sessions.create({
      mode: monthly ? "subscription" : "payment",
      submit_type: "donate",
      ...(customer ? { customer } : {}),
      line_items: [{ quantity: 1, price_data: {
        currency: "usd", unit_amount: amount, ...(monthly ? { recurring: { interval: "month" } } : {}),
        product_data: { name: "Support ForgeCenter", description: "A gift that keeps ForgeCenter's free tools free. Not tax-deductible." } } }],
      metadata,
      ...(monthly
        ? { subscription_data: { metadata, description: "Monthly donation to ForgeCenter" } }
        : { payment_intent_data: { metadata, description: "Donation to ForgeCenter" } }),
      custom_text: { submit: { message: SMALL_PRINT + (monthly ? MONTHLY_PRINT : "") } },
      success_url: `${baseUrl(req)}/donate?thanks=1&donation=${id}`,
      cancel_url: `${baseUrl(req)}/donate`,
      // Just over Stripe's 30-minute minimum, so an abandoned checkout clears quickly.
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      integration_identifier: CHECKOUT_LABELS.donation,
    });
    db.prepare("UPDATE donations SET stripe_session_id = ? WHERE id = ?").run(session.id, id);
    res.json({ url: session.url, donationId: id });
  } catch (e) {
    db.prepare("DELETE FROM donations WHERE id = ?").run(id);
    console.error("Donation checkout failed", e.message);
    res.status(502).json({ error: "Checkout couldn't start. Try again in a moment." });
  }
});
