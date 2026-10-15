// Shared test setup: an in-memory database and the app on a random port.
import { before, after } from "node:test";
import Stripe from "stripe";

process.env.DATABASE_PATH = ":memory:";
process.env.ADMIN_EMAILS = "owner@example.com";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.RESEND_API_KEY;

const { createApp } = await import("../src/app.js");
const { signInWith, createSession } = await import("../src/auth.js");
export const { db } = await import("../src/db.js");

let server, base;
before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

export const url = path => base + path;

export function signIn(email, sub = email) {
  const user = signInWith({ provider: "google", subject: sub, email, emailVerified: true, name: email.split("@")[0] });
  return { user, cookie: `fc_session=${createSession(user.id)}` };
}

export async function api(path, { method = "GET", body, cookie, headers = {} } = {}) {
  const r = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
}

// For endpoints that return a file.
export async function download(path, { body, cookie } = {}) {
  const r = await fetch(base + path, {
    method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });
  return { status: r.status, type: r.headers.get("content-type"), disposition: r.headers.get("content-disposition"), buf: Buffer.from(await r.arrayBuffer()) };
}

export function makeOrder(userId, product, status = "awaiting_payment") {
  return Number(db.prepare(`INSERT INTO orders (user_id, product, amount, status, created_at, updated_at)
    VALUES (?, ?, 1000, ?, 'now', 'now')`).run(userId, product, status).lastInsertRowid);
}

export async function sendWebhook(event) {
  const payload = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  return fetch(base + "/api/stripe/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload,
  });
}
