// Creator payouts with Stripe Connect. A creator connects their own Stripe account
// (Express) and makes pay links; buyers pay the creator directly (direct charges on
// the creator's account), so the money never sits with ForgeCenter. ForgeCenter only
// keeps a small application fee. Only confirmed adults can connect, as Stripe needs.
import express from "express";
import { db, now } from "./db.js";
import { getStripe, baseUrl } from "./stripe.js";
import { isAdult, requireUser } from "./auth.js";
import { rateLimit } from "./limit.js";
import { registerReportTarget } from "./reports.js";

db.exec(`CREATE TABLE IF NOT EXISTS payout_accounts (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL UNIQUE,
  charges_enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pay_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
)`);

export const LIMITS = { minCents: 100, maxCents: 100_000, links: 20 };
// ForgeCenter's cut of each payment, in percent. Stripe's own fee comes out of the creator's share.
const FEE_PERCENT = Number(process.env.PAYOUT_FEE_PERCENT ?? 5);
export const feeFor = cents => Math.round(cents * FEE_PERCENT / 100);

const accountOf = userId => db.prepare("SELECT * FROM payout_accounts WHERE user_id = ?").get(userId);
const publicLink = l => ({ id: l.id, title: l.title, description: l.description, amount: l.amount });

// Pay links shown on a creator page: only for a connected, unsuspended creator.
export function payLinksFor(userId) {
  return db.prepare(`SELECT l.* FROM pay_links l JOIN payout_accounts a ON a.user_id = l.user_id JOIN users u ON u.id = l.user_id
    WHERE l.user_id = ? AND l.hidden = 0 AND a.charges_enabled = 1 AND u.suspended_at IS NULL ORDER BY l.id`).all(userId).map(publicLink);
}

const liveLink = id => db.prepare(`SELECT l.*, a.account_id, u.name, p.handle FROM pay_links l
  JOIN payout_accounts a ON a.user_id = l.user_id JOIN users u ON u.id = l.user_id
  LEFT JOIN creator_profiles p ON p.user_id = l.user_id
  WHERE l.id = ? AND l.hidden = 0 AND a.charges_enabled = 1 AND u.suspended_at IS NULL`).get(id);

async function syncAccount(stripe, row) {
  const acct = await stripe.accounts.retrieve(row.account_id);
  db.prepare("UPDATE payout_accounts SET charges_enabled = ?, updated_at = ? WHERE user_id = ?").run(acct.charges_enabled ? 1 : 0, now(), row.user_id);
  return accountOf(row.user_id);
}

export const payoutsRouter = express.Router();
const noStripe = res => res.status(503).json({ error: "Payments aren't set up on this site yet." });

payoutsRouter.get("/mine", requireUser, async (req, res) => {
  let acct = accountOf(req.user.id);
  const stripe = getStripe();
  // Coming back from Stripe's onboarding: check whether the account can take payments now.
  if (acct && !acct.charges_enabled && stripe) { try { acct = await syncAccount(stripe, acct); } catch (e) { console.error("Payout account check failed", e.message); } }
  const links = db.prepare("SELECT * FROM pay_links WHERE user_id = ? ORDER BY id").all(req.user.id)
    .map(l => ({ ...publicLink(l), hidden: !!l.hidden }));
  res.json({ canConnect: isAdult(req.user), connected: !!acct, ready: !!acct?.charges_enabled, feePercent: FEE_PERCENT, links, limits: LIMITS });
});

// Starts or resumes Stripe's own onboarding, where the creator enters their details.
payoutsRouter.post("/connect", requireUser, rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  if (!isAdult(req.user)) return res.status(403).json({ error: "Confirm you're an adult to get paid. Stripe needs account holders to be 18 or over.", needs: "adult" });
  const stripe = getStripe();
  if (!stripe) return noStripe(res);
  let acct = accountOf(req.user.id);
  if (!acct) {
    const created = await stripe.accounts.create({
      type: "express", email: req.user.email ?? undefined, metadata: { user_id: String(req.user.id) },
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    });
    db.prepare("INSERT INTO payout_accounts (user_id, account_id, updated_at) VALUES (?, ?, ?)").run(req.user.id, created.id, now());
    acct = accountOf(req.user.id);
  }
  const link = await stripe.accountLinks.create({
    account: acct.account_id, type: "account_onboarding",
    refresh_url: `${baseUrl(req)}/account#payouts`, return_url: `${baseUrl(req)}/account?payouts=back#payouts`,
  });
  res.json({ url: link.url });
});

// Stripe's dashboard for the creator: payouts, balance and refunds are all theirs.
payoutsRouter.post("/dashboard", requireUser, async (req, res) => {
  const acct = accountOf(req.user.id);
  const stripe = getStripe();
  if (!stripe) return noStripe(res);
  if (!acct?.charges_enabled) return res.status(409).json({ error: "Finish connecting Stripe first." });
  const login = await stripe.accounts.createLoginLink(acct.account_id);
  res.json({ url: login.url });
});

payoutsRouter.post("/links", requireUser, rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  if (!accountOf(req.user.id)?.charges_enabled) return res.status(409).json({ error: "Connect Stripe before making pay links." });
  const title = String(req.body?.title ?? "").trim().slice(0, 80);
  const description = String(req.body?.description ?? "").trim().slice(0, 300);
  const amount = Math.round(Number(req.body?.amount) * 100);
  if (!title) return res.status(400).json({ error: "Give the pay link a name, like \"Custom skin\"." });
  if (!Number.isFinite(amount) || amount < LIMITS.minCents || amount > LIMITS.maxCents) return res.status(400).json({ error: "Set a price from $1 to $1,000." });
  const count = db.prepare("SELECT COUNT(*) AS n FROM pay_links WHERE user_id = ?").get(req.user.id).n;
  if (count >= LIMITS.links) return res.status(409).json({ error: `You can have up to ${LIMITS.links} pay links. Delete one first.` });
  const id = db.prepare("INSERT INTO pay_links (user_id, title, description, amount, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(req.user.id, title, description, amount, now()).lastInsertRowid;
  res.json({ link: publicLink(db.prepare("SELECT * FROM pay_links WHERE id = ?").get(id)) });
});

payoutsRouter.delete("/links/:id", requireUser, (req, res) => {
  const r = db.prepare("DELETE FROM pay_links WHERE id = ? AND user_id = ?").run(Number(req.params.id), req.user.id);
  if (!r.changes) return res.status(404).json({ error: "That pay link doesn't exist." });
  res.json({ ok: true });
});

payoutsRouter.get("/links/:id", (req, res) => {
  const l = liveLink(Number(req.params.id));
  if (!l) return res.status(404).json({ error: "This pay link isn't available. Check the link with the creator." });
  res.json({ link: { ...publicLink(l), creator: { name: l.name, handle: l.handle ?? null } } });
});

// Anyone can pay, signed in or not. The charge is made on the creator's own account.
payoutsRouter.post("/links/:id/checkout", rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  const l = liveLink(Number(req.params.id));
  if (!l) return res.status(404).json({ error: "This pay link isn't available. Check the link with the creator." });
  const stripe = getStripe();
  if (!stripe) return noStripe(res);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: l.amount, product_data: { name: l.title, ...(l.description ? { description: l.description } : {}) } } }],
    payment_intent_data: { application_fee_amount: feeFor(l.amount) },
    metadata: { kind: "pay_link", pay_link_id: String(l.id) },
    success_url: `${baseUrl(req)}/pay?l=${l.id}&paid=1`, cancel_url: `${baseUrl(req)}/pay?l=${l.id}`,
  }, { stripeAccount: l.account_id });
  res.json({ url: session.url });
});

// Pay links are public, so they can be reported; the owner can hide one.
const linkId = id => /^[1-9][0-9]{0,15}$/.test(id) ? Number(id) : null;
registerReportTarget("paylink", {
  exists: id => !!linkId(id) && !!liveLink(linkId(id)),
  describe: id => {
    const l = linkId(id) && db.prepare("SELECT id, title, user_id, hidden FROM pay_links WHERE id = ?").get(linkId(id));
    return l && { title: l.title, url: `/pay?l=${l.id}`, ownerUserId: l.user_id, state: l.hidden ? "hidden" : "visible" };
  },
  hide: id => db.prepare("UPDATE pay_links SET hidden = 1 WHERE id = ?").run(Number(id)).changes > 0,
});
