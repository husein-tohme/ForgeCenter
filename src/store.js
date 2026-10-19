// The store: sellers sell digital things (a repo's files as a download) and take
// donations. Payments are Stripe Checkout direct charges on the seller's own connected
// account, so buyer money goes to the seller and Forgehub takes only its fee. Payment
// methods (cards, Apple Pay, Google Pay, PayPal where available) are chosen in the
// Stripe Dashboard, not in code. Digital goods only: nothing ships.
import express from "express";
import Stripe from "stripe";
import archiver from "archiver";
import { db, now } from "./db.js";
import { isAdult, requireUser } from "./auth.js";
import { rateLimit } from "./limit.js";

export const FEE_PERCENT = Number(process.env.FEE_PERCENT ?? 5);
export const PRICE = { min: 50, max: 100000 };
let client;
export function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient((...a) => globalThis.fetch(...a)) });
  return client;
}
const site = req => (process.env.BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
const soon = res => res.status(503).json({ error: "Payments open soon. Everything else works now.", soon: true });
const fee = cents => Math.round(cents * FEE_PERCENT / 100);

const productJson = p => ({ id: p.id, title: p.title, description: p.description, priceCents: p.price_cents, kind: p.kind,
  seller: p.username, repo: p.repo_name ?? null, active: !!p.active, createdAt: p.created_at });
const PRODUCT_SELECT = `SELECT p.*, u.username, u.stripe_account_id, u.stripe_charges_enabled, u.suspended_at, r.name AS repo_name
  FROM products p JOIN users u ON u.id = p.user_id LEFT JOIN repos r ON r.id = p.repo_id`;

export const storeRouter = express.Router();

// Public listing: live products from sellers who aren't suspended.
storeRouter.get("/products", (req, res) => {
  const q = String(req.query.q ?? "").trim().slice(0, 60);
  const user = String(req.query.user ?? "").toLowerCase();
  const rows = db.prepare(`${PRODUCT_SELECT} WHERE p.active = 1 AND p.kind = 'file' AND u.suspended_at IS NULL
    AND (? = '' OR u.username = ?) AND (? = '' OR p.title LIKE ? OR p.description LIKE ?) ORDER BY p.id DESC LIMIT 60`)
    .all(user, user, q, `%${q}%`, `%${q}%`);
  res.json({ products: rows.map(productJson), payments: !!stripe() });
});

storeRouter.get("/products/:id", (req, res) => {
  const p = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(Number(req.params.id));
  if (!p || (!p.active && p.user_id !== req.user?.id) || p.suspended_at) return res.status(404).json({ error: "That item isn't for sale." });
  const owned = !!(req.user && db.prepare("SELECT 1 FROM purchases WHERE product_id = ? AND buyer_id = ? AND status = 'paid'").get(p.id, req.user.id));
  res.json({ product: productJson(p), owned, mine: p.user_id === req.user?.id, payments: !!stripe() && !!p.stripe_charges_enabled });
});

// ---------- Selling ----------
storeRouter.get("/mine", requireUser, async (req, res) => {
  const u = req.user;
  if (u.stripe_account_id && !u.stripe_charges_enabled && stripe()) {
    try {
      const acct = await stripe().accounts.retrieve(u.stripe_account_id);
      if (acct.charges_enabled) db.prepare("UPDATE users SET stripe_charges_enabled = 1 WHERE id = ?").run(u.id);
      u.stripe_charges_enabled = acct.charges_enabled ? 1 : 0;
    } catch (e) { console.error("Stripe account check failed", e.message); }
  }
  const products = db.prepare(`${PRODUCT_SELECT} WHERE p.user_id = ? ORDER BY p.id DESC`).all(u.id);
  const sales = db.prepare(`SELECT s.id, s.amount_cents, s.kind, s.paid_at, p.title FROM purchases s LEFT JOIN products p ON p.id = s.product_id
    WHERE s.seller_id = ? AND s.status = 'paid' ORDER BY s.id DESC LIMIT 50`).all(u.id);
  res.json({ payments: !!stripe(), adult: isAdult(u), connected: !!u.stripe_account_id, canSell: !!u.stripe_charges_enabled,
    feePercent: FEE_PERCENT, products: products.map(productJson),
    sales: sales.map(s => ({ id: s.id, amountCents: s.amount_cents, kind: s.kind, title: s.title ?? "Donation", paidAt: s.paid_at })) });
});

// Stripe Express onboarding. Stripe verifies the seller (it requires adults).
storeRouter.post("/connect", requireUser, rateLimit({ windowMs: 60_000, max: 5 }), async (req, res) => {
  if (!stripe()) return soon(res);
  if (!isAdult(req.user)) return res.status(403).json({ error: "Selling needs an adult account, because Stripe only pays out to people 18 and over." });
  let id = req.user.stripe_account_id;
  if (!id) {
    const acct = await stripe().accounts.create({ type: "express", email: req.user.email ?? undefined,
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } }, metadata: { user_id: String(req.user.id) } });
    id = acct.id;
    db.prepare("UPDATE users SET stripe_account_id = ? WHERE id = ?").run(id, req.user.id);
  }
  const link = await stripe().accountLinks.create({ account: id, type: "account_onboarding",
    refresh_url: `${site(req)}/store?connect=retry`, return_url: `${site(req)}/store?connect=done` });
  res.json({ url: link.url });
});

storeRouter.post("/products", requireUser, rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  const b = req.body ?? {};
  const title = String(b.title ?? "").trim().slice(0, 80);
  const price = Number(b.priceCents);
  if (!title) return res.status(400).json({ error: "Give it a title." });
  if (!Number.isInteger(price) || price < PRICE.min || price > PRICE.max) return res.status(400).json({ error: "Prices go from $0.50 to $1,000." });
  const repo = db.prepare("SELECT id FROM repos WHERE user_id = ? AND name = ? COLLATE NOCASE").get(req.user.id, String(b.repo ?? ""));
  if (!repo) return res.status(400).json({ error: "Pick one of your repos. Buyers download its files." });
  const p = db.prepare(`INSERT INTO products (user_id, repo_id, title, description, price_cents, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`)
    .get(req.user.id, repo.id, title, String(b.description ?? "").trim().slice(0, 2000), price, now());
  res.status(201).json({ product: productJson(db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(p.id)) });
});

storeRouter.patch("/products/:id", requireUser, (req, res) => {
  const p = db.prepare("SELECT * FROM products WHERE id = ? AND user_id = ?").get(Number(req.params.id), req.user.id);
  if (!p) return res.status(404).json({ error: "That isn't your item." });
  if (typeof req.body?.active === "boolean") db.prepare("UPDATE products SET active = ? WHERE id = ?").run(req.body.active ? 1 : 0, p.id);
  res.json({ product: productJson(db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(p.id)) });
});

// ---------- Buying ----------
async function checkout(req, res, { seller, amount, kind, product = null, name }) {
  if (!stripe()) return soon(res);
  if (!seller.stripe_charges_enabled || seller.suspended_at) return res.status(409).json({ error: "This seller can't take payments right now." });
  if (seller.id === req.user.id) return res.status(400).json({ error: "You can't pay yourself." });
  const purchase = db.prepare(`INSERT INTO purchases (product_id, buyer_id, seller_id, amount_cents, kind, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`)
    .get(product?.id ?? null, req.user.id, seller.id, amount, kind, now());
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: amount, product_data: { name } } }],
    payment_intent_data: { application_fee_amount: fee(amount), metadata: { purchase_id: String(purchase.id) } },
    metadata: { kind, purchase_id: String(purchase.id) },
    success_url: `${site(req)}/library?paid=${purchase.id}`, cancel_url: `${site(req)}${product ? `/store/${product.id}` : `/${seller.username}`}`,
  }, { stripeAccount: seller.stripe_account_id });
  db.prepare("UPDATE purchases SET stripe_session_id = ? WHERE id = ?").run(session.id, purchase.id);
  res.json({ url: session.url });
}

storeRouter.post("/products/:id/checkout", requireUser, rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  const p = db.prepare(`SELECT p.*, u.username FROM products p JOIN users u ON u.id = p.user_id WHERE p.id = ? AND p.active = 1`).get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: "That item isn't for sale." });
  if (db.prepare("SELECT 1 FROM purchases WHERE product_id = ? AND buyer_id = ? AND status = 'paid'").get(p.id, req.user.id)) {
    return res.status(409).json({ error: "You already own this. It's in your library." });
  }
  const seller = db.prepare("SELECT * FROM users WHERE id = ?").get(p.user_id);
  await checkout(req, res, { seller, amount: p.price_cents, kind: "purchase", product: p, name: p.title });
});

storeRouter.post("/donate/:username", requireUser, rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  const seller = db.prepare("SELECT * FROM users WHERE username = ?").get(String(req.params.username).toLowerCase());
  const amount = Number(req.body?.amountCents);
  if (!seller) return res.status(404).json({ error: "No one has that username." });
  if (!Number.isInteger(amount) || amount < 100 || amount > 50000) return res.status(400).json({ error: "Donations go from $1 to $500." });
  await checkout(req, res, { seller, amount, kind: "donation", name: `Donation to @${seller.username}` });
});

storeRouter.get("/library", requireUser, (req, res) => {
  const rows = db.prepare(`SELECT s.id, s.amount_cents, s.kind, s.status, s.paid_at, p.id AS product_id, p.title, u.username AS seller
    FROM purchases s LEFT JOIN products p ON p.id = s.product_id LEFT JOIN users u ON u.id = s.seller_id
    WHERE s.buyer_id = ? AND s.status = 'paid' ORDER BY s.id DESC`).all(req.user.id);
  res.json({ items: rows.map(r => ({ id: r.id, kind: r.kind, title: r.title ?? `Donation to @${r.seller}`, seller: r.seller,
    amountCents: r.amount_cents, paidAt: r.paid_at, productId: r.product_id, download: r.kind === "purchase" && r.product_id ? `/download/${r.id}` : null })) });
});

// The buyer's download: the product's repo as a zip, as it is now (updates included).
export const downloadRouter = express.Router();
downloadRouter.get("/download/:id", (req, res, next) => {
  const s = req.user && db.prepare(`SELECT s.*, p.repo_id, r.name FROM purchases s JOIN products p ON p.id = s.product_id JOIN repos r ON r.id = p.repo_id
    WHERE s.id = ? AND s.buyer_id = ? AND s.status = 'paid'`).get(Number(req.params.id), req.user.id);
  if (!s) return next();
  res.set({ "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${s.name.replace(/[^\w.-]/g, "_")}.zip"` });
  const zip = archiver("zip");
  zip.pipe(res);
  for (const f of db.prepare("SELECT path, data FROM repo_files WHERE repo_id = ?").iterate(s.repo_id)) zip.append(Buffer.from(f.data), { name: `${s.name}/${f.path}` });
  zip.finalize();
});

// ---------- Stripe webhook: the only place a purchase becomes paid ----------
export async function stripeWebhook(req, res) {
  const s = stripe();
  if (!s || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).end();
  let event;
  try { event = s.webhooks.constructEvent(req.body, req.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET); }
  catch { return res.status(400).send("Bad signature"); }
  if (db.prepare("INSERT OR IGNORE INTO stripe_events (id, received_at) VALUES (?, ?)").run(event.id, now()).changes === 0) return res.json({ duplicate: true });
  const o = event.data.object;
  if ((event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") && o.payment_status === "paid") {
    db.prepare("UPDATE purchases SET status = 'paid', paid_at = ? WHERE stripe_session_id = ? AND status = 'pending'").run(now(), o.id);
  } else if (event.type === "charge.refunded") {
    db.prepare("UPDATE purchases SET status = 'refunded' WHERE id = ?").run(Number(o.metadata?.purchase_id));
  } else if (event.type === "account.updated") {
    db.prepare("UPDATE users SET stripe_charges_enabled = ? WHERE stripe_account_id = ?").run(o.charges_enabled ? 1 : 0, o.id);
  }
  res.json({ received: true });
}
