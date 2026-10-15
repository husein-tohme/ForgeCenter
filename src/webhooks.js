// Stripe webhooks: signature-checked, handled once per event id, then routed by what
// the Checkout Session (or other object) was for.
import { db, now } from "./db.js";
import { getStripe, checkoutKind } from "./stripe.js";
import { handleOrderEvent } from "./orders.js";
import { handleWalletEvent } from "./wallet.js";
import { handleAgeEvent } from "./age.js";

export async function handleStripeEvent(event) {
  const obj = event.data.object;
  if (event.type.startsWith("identity.verification_session.")) return handleAgeEvent(event);
  if (event.type.startsWith("checkout.session.")) {
    const kind = checkoutKind(obj);
    if (kind === "age_check") return handleAgeEvent(event);
    if (kind === "wallet_topup") return handleWalletEvent(event);
    if (kind === "order") return handleOrderEvent(event);
    return;
  }
  if (event.type === "charge.refunded") return handleWalletEvent(event);
  return handleOrderEvent(event);
}

// Mounted with express.raw() so the signature can be checked against the exact bytes.
export async function stripeWebhook(req, res) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return res.status(503).json({ error: "Stripe webhooks aren't set up yet." });
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], secret); }
  catch { return res.status(400).json({ error: "Invalid Stripe signature." }); }

  const fresh = db.prepare("INSERT OR IGNORE INTO webhook_events (id, received_at) VALUES (?, ?)").run(event.id, now()).changes;
  if (!fresh) return res.json({ received: true });
  try { await handleStripeEvent(event); }
  catch (e) {
    db.prepare("DELETE FROM webhook_events WHERE id = ?").run(event.id); // let Stripe retry
    console.error("Webhook failed", event.type, e.message);
    return res.status(500).json({ error: "Webhook handling failed." });
  }
  res.json({ received: true });
}
