import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { api, db, sendWebhook, signIn } from "./helpers.js";
import { installFakeStripe } from "./fake-stripe.js";

let stripe;
afterEach(() => stripe?.restore());

const yearsAgo = n => { const d = new Date(); return { year: d.getUTCFullYear() - n, month: d.getUTCMonth() + 1, day: d.getUTCDate() }; };
const userRow = id => db.prepare("SELECT * FROM users WHERE id = ?").get(id);
let eventId = 0;
const event = (type, object) => sendWebhook({ id: `evt_age_${++eventId}`, type, data: { object } });

test("new accounts answer a birthday question first, and start in the teen group", async () => {
  const { user, cookie } = signIn("newbie@example.com", "newbie", { age: null });
  const blocked = await api("/api/orders", { cookie });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.needs, "birthday");
  assert.equal((await api("/api/me", { cookie })).body.user.ageGroup, null);

  const feb30 = await api("/api/me/birthday", { method: "POST", cookie, body: { year: 2000, month: 2, day: 30, acceptTerms: true } });
  assert.equal(feb30.status, 400);
  const future = await api("/api/me/birthday", { method: "POST", cookie, body: { ...yearsAgo(-1), acceptTerms: true } });
  assert.equal(future.status, 400);

  // Even a 40-year-old starts as a teen, like Discord, until they confirm their age.
  const noTick = await api("/api/me/birthday", { method: "POST", cookie, body: yearsAgo(40) });
  assert.equal(noTick.status, 400);
  assert.match(noTick.body.error, /terms/);
  const r = await api("/api/me/birthday", { method: "POST", cookie, body: { ...yearsAgo(40), acceptTerms: true } });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.ageGroup, "teen");
  assert.equal((await api("/api/orders", { cookie })).status, 200);
  // The answer can't be changed afterwards, and the birthday itself isn't stored.
  await api("/api/me/birthday", { method: "POST", cookie, body: { ...yearsAgo(5), acceptTerms: true } });
  assert.equal(userRow(user.id).age_group, "teen");
  assert.ok(!Object.keys(userRow(user.id)).some(k => /birth|dob/.test(k)));
});

test("people under 13 are turned away and their new account isn't kept", async () => {
  const { user, cookie } = signIn("kid@example.com", "kid", { age: null });
  const r = await api("/api/me/birthday", { method: "POST", cookie, body: { ...yearsAgo(11), acceptTerms: true } });
  assert.equal(r.status, 403);
  assert.equal(r.body.needs, "closed");
  assert.equal(userRow(user.id), undefined);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM identities WHERE user_id = ?").get(user.id).n, 0);
  const block = r.headers.get("set-cookie").match(/fc_age_block=[^;]+/)[0];

  // Trying again straight away in the same browser with another date doesn't work.
  const again = signIn("kid2@example.com", "kid2", { age: null });
  const retry = await api("/api/me/birthday", { method: "POST", cookie: `${again.cookie}; ${block}`, body: yearsAgo(20) });
  assert.equal(retry.status, 403);
  assert.equal(retry.body.needs, "blocked");
  assert.equal(userRow(again.user.id).age_group, null);
});

test("adult-only products need a confirmed adult", async () => {
  const teen = signIn("teen-buyer@example.com");
  for (const [path, product] of [["/api/checkout", "game"], ["/api/checkout", "website"], ["/api/wallet/pay", "game"]]) {
    const r = await api(path, { method: "POST", cookie: teen.cookie, body: { product } });
    assert.equal(r.status, 403, `${path} ${product}`);
    assert.equal(r.body.needs, "adult");
  }
  const catalog = (await api("/api/catalog")).body;
  assert.equal(catalog.game.adultOnly, true);
  assert.equal(catalog.discord.adultOnly, false);
});

function completeCardCheck(session, funding) {
  const si = { id: `seti_${session.id}`, object: "setup_intent", status: "succeeded",
    payment_method: { id: `pm_${session.id}`, object: "payment_method", type: "card", card: { funding } } };
  stripe.state.setupIntents.set(si.id, si);
  Object.assign(stripe.state.sessions.get(session.id), { status: "complete", setup_intent: si.id });
  return { ...stripe.state.sessions.get(session.id), params: undefined };
}

test("a credit card check confirms an adult, and the card isn't kept", async () => {
  stripe = installFakeStripe();
  const { user, cookie } = signIn("cardholder@example.com");
  const r = await api("/api/age/card", { method: "POST", cookie, body: {} });
  assert.equal(r.status, 200);
  assert.match(r.body.url, /^https:\/\/checkout\.stripe\.com\//);
  const session = stripe.lastCheckout();
  assert.equal(session.params.mode, "setup");
  assert.equal(session.params.currency, "usd");
  assert.equal(session.params.metadata.kind, "age_check");
  assert.match(session.params.integration_identifier, /^forgecenter-agecheck-[a-z]{8}$/);
  assert.ok(Number(session.params.expires_at) - Date.now() / 1000 > 30 * 60);

  const completed = completeCardCheck(session, "credit");
  assert.equal((await event("checkout.session.completed", completed)).status, 200);
  const u = userRow(user.id);
  assert.equal(u.age_group, "adult");
  assert.equal(u.age_method, "credit_card");
  assert.deepEqual(stripe.state.detached, [`pm_${session.id}`]);
  // Already confirmed, so there's nothing more to start.
  assert.equal((await api("/api/age/id", { method: "POST", cookie, body: {} })).status, 409);
});

test("debit cards don't count, and the result shows when the person comes back", async () => {
  stripe = installFakeStripe();
  const { user, cookie } = signIn("debit@example.com");
  const started = await api("/api/age/card", { method: "POST", cookie, body: {} });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const session = stripe.lastCheckout();
  completeCardCheck(session, "debit");
  // No webhook yet: the account page catches up with Stripe itself.
  const check = db.prepare("SELECT id FROM age_checks WHERE user_id = ?").get(user.id).id;
  const r = await api(`/api/age?check=${check}`, { cookie });
  assert.equal(r.body.check.status, "failed");
  assert.match(r.body.check.message, /debit card/);
  assert.equal(r.body.user.ageGroup, "teen");
  assert.equal(stripe.state.detached.length, 1);
});

test("an ID scan reads the date of birth, then has Stripe delete the data", async () => {
  stripe = installFakeStripe();
  const adult = signIn("id-adult@example.com");
  const r = await api("/api/age/id", { method: "POST", cookie: adult.cookie, body: {} });
  assert.match(r.body.url, /^https:\/\/verify\.stripe\.com\//);
  const vs = stripe.lastVerification();
  assert.equal(vs.params.type, "document");
  assert.equal(vs.params.options.document.require_matching_selfie, "true");
  Object.assign(vs, { status: "verified", verified_outputs: { dob: yearsAgo(30) } });
  await event("identity.verification_session.verified", { id: vs.id, object: "identity.verification_session" });
  assert.equal(userRow(adult.user.id).age_group, "adult");
  assert.equal(userRow(adult.user.id).age_method, "id_scan");
  assert.deepEqual(stripe.state.redacted, [vs.id]);

  // A 16-year-old stays a teen, and can't then switch to a (parent's) credit card.
  const teen = signIn("id-teen@example.com");
  await api("/api/age/id", { method: "POST", cookie: teen.cookie, body: {} });
  const teenVs = stripe.lastVerification();
  Object.assign(teenVs, { status: "verified", verified_outputs: { dob: yearsAgo(16) } });
  await event("identity.verification_session.verified", { id: teenVs.id, object: "identity.verification_session" });
  assert.equal(userRow(teen.user.id).age_group, "teen");
  assert.ok(stripe.state.redacted.includes(teenVs.id));
  const status = await api("/api/age", { cookie: teen.cookie });
  assert.match(status.body.check.message, /under 18/);
  assert.equal((await api("/api/age/card", { method: "POST", cookie: teen.cookie, body: {} })).status, 403);
});

test("an ID with only a birth year counts the birthday as the end of that year", async () => {
  stripe = installFakeStripe();
  const { user, cookie } = signIn("year-only@example.com");
  await api("/api/age/id", { method: "POST", cookie, body: {} });
  const vs = stripe.lastVerification();
  // Turns 18 this calendar year, so without a month and day they might still be 17.
  Object.assign(vs, { status: "verified", verified_outputs: { dob: { year: new Date().getUTCFullYear() - 18, month: null, day: null } } });
  await event("identity.verification_session.verified", { id: vs.id, object: "identity.verification_session", metadata: { kind: "age_check" } });
  assert.equal(userRow(user.id).age_group, "teen");
});

test("ID data is deleted at Stripe even if the account is gone, and a failed delete is retried", async () => {
  stripe = installFakeStripe();
  const { user, cookie } = signIn("gone@example.com");
  await api("/api/age/id", { method: "POST", cookie, body: {} });
  const vs = stripe.lastVerification();
  db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
  Object.assign(vs, { status: "verified", verified_outputs: { dob: yearsAgo(30) } });
  await event("identity.verification_session.verified", { id: vs.id, object: "identity.verification_session", metadata: { kind: "age_check" } });
  assert.ok(stripe.state.redacted.includes(vs.id));

  // Stripe is briefly down when we ask it to delete: the webhook fails so Stripe sends it again.
  const other = signIn("retry-redact@example.com");
  await api("/api/age/id", { method: "POST", cookie: other.cookie, body: {} });
  const vs2 = stripe.lastVerification();
  Object.assign(vs2, { status: "verified", verified_outputs: { dob: yearsAgo(30) } });
  const fakeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => (String(input.url ?? input).endsWith("/redact")
    ? Promise.resolve(new Response(JSON.stringify({ error: { message: "down" } }), { status: 500, headers: { "content-type": "application/json" } }))
    : fakeFetch(input, init));
  const body = { id: "evt_redact_retry", type: "identity.verification_session.verified", data: { object: { id: vs2.id, object: "identity.verification_session", metadata: { kind: "age_check" } } } };
  assert.equal((await sendWebhook(body)).status, 500);
  globalThis.fetch = fakeFetch;
  assert.equal(userRow(other.user.id).age_group, "adult"); // the result itself was kept
  assert.equal((await sendWebhook(body)).status, 200);
  assert.ok(stripe.state.redacted.includes(vs2.id));
});

test("a failed ID scan explains why and still deletes the data", async () => {
  stripe = installFakeStripe();
  const { user, cookie } = signIn("id-blurry@example.com");
  await api("/api/age/id", { method: "POST", cookie, body: {} });
  const vs = stripe.lastVerification();
  Object.assign(vs, { last_error: { code: "document_expired", reason: "Expired" } });
  await event("identity.verification_session.requires_input", { id: vs.id, object: "identity.verification_session" });
  const r = await api("/api/age", { cookie });
  assert.match(r.body.check.message, /expired/);
  assert.equal(userRow(user.id).age_group, "teen");
  assert.deepEqual(stripe.state.redacted, [vs.id]);
});

test("18+ showcase listings are hidden from teens and visitors, like age-restricted channels", async () => {
  const adult = signIn("listing-adult@example.com", "listing-adult", { age: "adult" });
  const teen = signIn("listing-teen@example.com");
  for (const who of [adult, teen]) {
    db.prepare(`INSERT INTO orders (user_id, product, amount, status, created_at, updated_at)
      VALUES (?, 'showcase', 1000, 'paid', 'now', 'now')`).run(who.user.id);
  }
  const listing = { title: "Horror Map", url: "https://horror.example", description: "Spooky", adultOnly: true };
  assert.equal((await api("/api/showcase", { method: "POST", cookie: teen.cookie, body: listing })).status, 403);
  assert.equal((await api("/api/showcase", { method: "POST", cookie: adult.cookie, body: listing })).status, 201);
  db.prepare("UPDATE showcase SET status = 'approved' WHERE title = 'Horror Map'").run();

  const hidden = (await api("/api/showcase", { cookie: teen.cookie })).body.listings.find(l => l.adultOnly);
  assert.equal(hidden.restricted, true);
  assert.equal(hidden.title, undefined);
  assert.equal(hidden.url, undefined);
  assert.equal((await api("/api/showcase")).body.listings.find(l => l.adultOnly).url, undefined);
  const shown = (await api("/api/showcase", { cookie: adult.cookie })).body.listings.find(l => l.adultOnly);
  assert.equal(shown.url, "https://horror.example");
});

test("owners skip the age check without their stored age group changing", async () => {
  const { cookie, user } = signIn("owner@example.com");
  const me = (await api("/api/me", { cookie })).body.user;
  assert.equal(me.ageGroup, "adult");
  assert.equal(db.prepare("SELECT age_group FROM users WHERE id = ?").get(user.id).age_group, "teen");
});
