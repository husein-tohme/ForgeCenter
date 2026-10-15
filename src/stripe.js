// The Stripe client and helpers shared by orders, the wallet and age checks.
import Stripe from "stripe";
import { db } from "./db.js";

let stripeClient;
export function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  // Stripe's fetch-based client, looking fetch up on each call so tests can simulate
  // Stripe the same way they simulate other services.
  stripeClient ??= new Stripe(process.env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient((...args) => globalThis.fetch(...args)),
  });
  return stripeClient;
}

export const baseUrl = req => process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;

// Each Checkout flow has its own label so they can be compared in the Stripe Dashboard.
export const CHECKOUT_LABELS = {
  shop: "forgecenter-shop-qzvkmrtw",
  wallet: "forgecenter-wallet-hbtqzmfa",
  ageCheck: "forgecenter-agecheck-wkdnrpyx",
};

export async function ensureCustomer(stripe, user) {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const customer = await stripe.customers.create({
    email: user.email ?? undefined, phone: user.phone ?? undefined, name: user.name, metadata: { user_id: String(user.id) },
  });
  db.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?").run(customer.id, user.id);
  return customer.id;
}

// What a Checkout Session was for. Shop orders predate this and carry no kind.
export const checkoutKind = session => session?.metadata?.kind ?? "order";
