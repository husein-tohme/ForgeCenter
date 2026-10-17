// A small simulation of the Stripe API calls ForgeCenter makes, installed by stubbing
// globalThis.fetch. Requests to anything else go through untouched.
import assert from "node:assert/strict";

const realFetch = globalThis.fetch;
let counter = 0; // ids stay unique across tests that share one database

// Stripe sends form-encoded bodies with bracket keys; this turns them back into objects.
function parseForm(text) {
  const out = {};
  for (const [key, value] of new URLSearchParams(text ?? "")) {
    const path = key.replace(/\]/g, "").split("[");
    let node = out;
    path.forEach((part, i) => {
      if (i === path.length - 1) node[part] = value;
      else node = node[part] ??= /^\d+$/.test(path[i + 1]) ? [] : {};
    });
  }
  return out;
}

export function installFakeStripe() {
  const state = {
    requests: [],
    sessions: new Map(),        // Checkout Sessions by id
    subscriptions: new Map(),   // Subscriptions by id; tests add the ones Checkout would create
    expired: [],                // Checkout Sessions closed early
    setupIntents: new Map(),
    verifications: new Map(),   // Identity VerificationSessions
    detached: [],
    redacted: [],
  };
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    if (u.hostname !== "api.stripe.com") return realFetch(input, init);
    const method = init.method || "GET";
    const body = parseForm(init.body);
    state.requests.push({ method, path: u.pathname, body });
    // Dynamic payment methods: ForgeCenter never restricts payment method types.
    assert.equal(body.payment_method_types, undefined);
    let m;
    if (method === "POST" && u.pathname === "/v1/customers") return json({ id: `cus_${++counter}`, object: "customer" });
    if (method === "POST" && u.pathname === "/v1/checkout/sessions") {
      const id = `cs_test_${++counter}`;
      const session = { id, object: "checkout.session", url: `https://checkout.stripe.com/c/pay/${id}`, status: "open",
        payment_status: "unpaid", mode: body.mode, metadata: body.metadata ?? {}, setup_intent: null, payment_intent: null };
      state.sessions.set(id, { ...session, params: body });
      return json(session);
    }
    if ((m = u.pathname.match(/^\/v1\/checkout\/sessions\/([^/]+)\/expire$/))) {
      const s = state.sessions.get(m[1]);
      if (!s) return json({ error: { message: "No such session" } }, 404);
      if (s.status !== "open") return json({ error: { message: "Only open sessions can be expired" } }, 400);
      state.expired.push(m[1]);
      s.status = "expired";
      return json(s);
    }
    if ((m = u.pathname.match(/^\/v1\/checkout\/sessions\/([^/]+)$/))) {
      const s = state.sessions.get(m[1]);
      return s ? json(s) : json({ error: { message: "No such session" } }, 404);
    }
    if ((m = u.pathname.match(/^\/v1\/subscriptions\/([^/]+)$/))) {
      const sub = state.subscriptions.get(m[1]);
      if (!sub) return json({ error: { message: "No such subscription" } }, 404);
      if (method === "POST") {
        // Form values arrive as strings; an empty cancel_at clears it, as in Stripe.
        if (body.cancel_at_period_end !== undefined) sub.cancel_at_period_end = body.cancel_at_period_end === "true";
        if (body.cancel_at !== undefined) sub.cancel_at = body.cancel_at ? Number(body.cancel_at) : null;
      }
      return json(sub);
    }
    if ((m = u.pathname.match(/^\/v1\/setup_intents\/([^/]+)$/))) {
      const si = state.setupIntents.get(m[1]);
      return si ? json(si) : json({ error: { message: "No such setup intent" } }, 404);
    }
    if ((m = u.pathname.match(/^\/v1\/payment_methods\/([^/]+)\/detach$/))) {
      state.detached.push(m[1]);
      return json({ id: m[1], object: "payment_method", customer: null });
    }
    if (method === "POST" && u.pathname === "/v1/identity/verification_sessions") {
      const id = `vs_test_${++counter}`;
      const vs = { id, object: "identity.verification_session", url: `https://verify.stripe.com/start/${id}`,
        status: "requires_input", last_error: null, redaction: null, metadata: body.metadata ?? {}, verified_outputs: null };
      state.verifications.set(id, { ...vs, params: body });
      return json(vs);
    }
    if ((m = u.pathname.match(/^\/v1\/identity\/verification_sessions\/([^/]+)\/redact$/))) {
      state.redacted.push(m[1]);
      const vs = state.verifications.get(m[1]);
      vs.redaction = { status: "processing" };
      return json(vs);
    }
    if ((m = u.pathname.match(/^\/v1\/identity\/verification_sessions\/([^/]+)$/))) {
      const vs = state.verifications.get(m[1]);
      if (!vs) return json({ error: { message: "No such verification session" } }, 404);
      // The date of birth only comes back when it's asked for explicitly.
      const expand = u.searchParams.getAll("expand[]").concat(u.searchParams.getAll("expand[0]"));
      const outputs = vs.verified_outputs && { ...vs.verified_outputs, dob: expand.includes("verified_outputs.dob") ? vs.verified_outputs.dob : undefined };
      return json({ ...vs, verified_outputs: outputs });
    }
    return json({ error: { message: `Fake Stripe doesn't know ${method} ${u.pathname}` } }, 404);
  };

  return {
    state,
    lastCheckout: () => [...state.sessions.values()].at(-1),
    // A subscription as Checkout would create it, with the period on its item (current API versions).
    addSubscription: (id, { metadata = {}, periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 3600 } = {}) => {
      const sub = { id, object: "subscription", status: "active", cancel_at_period_end: false, cancel_at: null, metadata,
        items: { object: "list", data: [{ id: `si_${++counter}`, object: "subscription_item", current_period_end: periodEnd }] } };
      state.subscriptions.set(id, sub);
      return sub;
    },
    lastVerification: () => [...state.verifications.values()].at(-1),
    restore: () => { globalThis.fetch = realFetch; },
  };
}
