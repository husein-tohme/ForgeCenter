import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { api, db, sendWebhook, signIn, url } from "./helpers.js";
import { installFakeStripe } from "./fake-stripe.js";
import { setEmailTransport } from "../src/email.js";

let stripe;
afterEach(() => stripe?.restore());
const emails = [];
setEmailTransport(async m => { emails.push(m); return true; });
const settle = () => new Promise(r => setTimeout(r, 20));

let eventId = 0;
const event = (type, object) => sendWebhook({ id: `evt_launch_${++eventId}`, type, data: { object } });
let subCounter = 0;
const newSubId = () => `sub_launch_${++subCounter}`;

const valid = (over = {}) => ({
  title: "Sky Wars", tagline: "Fight on floating islands", description: "Last one standing wins.\nUp to 12 players.",
  platform: "web", playUrl: "https://example.com/play", icon: "sword", accent: "lapis", tags: ["pvp", "multiplayer"], ...over,
});

async function create(cookie, over = {}) {
  const r = await api("/api/games", { method: "POST", cookie, body: valid(over) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.game;
}
const mine = async (cookie, id) => (await api("/api/games/mine", { cookie })).body.games.find(g => g.id === id);
const directory = async (query = "", cookie) => (await api(`/api/games${query}`, { cookie })).body.games;

// Starts a launch and pays for it with a signed webhook, as Stripe would after Checkout.
async function launchAndPay(cookie, gameId, subId = newSubId()) {
  const r = await api(`/api/games/${gameId}/launch`, { method: "POST", cookie, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const session = stripe.lastCheckout();
  const sub = stripe.addSubscription(subId, { metadata: session.metadata });
  const res = await event("checkout.session.completed", {
    id: session.id, object: "checkout.session", mode: "subscription", status: "complete",
    payment_status: "paid", subscription: subId, metadata: session.metadata });
  assert.equal(res.status, 200);
  return { session, sub, orderId: r.body.orderId };
}

test("creators make, edit and delete drafts, and only they can see or change them", async () => {
  const a = signIn("maker@example.com"), b = signIn("other-maker@example.com");
  assert.equal((await api("/api/games", { method: "POST", body: valid() })).status, 401);

  const g = await create(a.cookie);
  assert.equal(g.status, "draft");
  assert.equal(g.live, false);
  assert.deepEqual(g.tags, ["pvp", "multiplayer"]);

  // A draft is visible to its creator only, and isn't on the games page.
  assert.equal((await api(`/api/games/${g.id}`, { cookie: a.cookie })).body.mine, true);
  assert.equal((await api(`/api/games/${g.id}`, { cookie: b.cookie })).status, 404);
  assert.equal((await api(`/api/games/${g.id}`)).status, 404);
  assert.ok(!(await directory()).some(x => x.id === g.id));

  const edited = await api(`/api/games/${g.id}`, { method: "PATCH", cookie: a.cookie, body: { title: "  Sky   Wars 2 ", tags: ["pvp", "pvp"] } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.game.title, "Sky Wars 2");
  assert.deepEqual(edited.body.game.tags, ["pvp"]);
  assert.equal(edited.body.game.playUrl, "https://example.com/play"); // fields not sent keep their values

  assert.equal((await api(`/api/games/${g.id}`, { method: "PATCH", cookie: b.cookie, body: { title: "Mine now" } })).status, 404);
  assert.equal((await api(`/api/games/${g.id}`, { method: "DELETE", cookie: b.cookie, body: {} })).status, 404);
  assert.equal((await api(`/api/games/${g.id}/launch`, { method: "POST", cookie: b.cookie, body: {} })).status, 404);
  assert.equal((await api(`/api/games/${g.id}`, { method: "DELETE", cookie: a.cookie, body: {} })).status, 200);
  assert.equal((await api("/api/games/mine", { cookie: a.cookie })).body.games.length, 0);
});

test("game details are checked: links, server addresses, trailers, tags and choices", async () => {
  let { cookie } = signIn("checker@example.com");
  const bad = async (over, field) => {
    const r = await api("/api/games", { method: "POST", cookie, body: valid(over) });
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.equal(r.body.field, field, JSON.stringify(over));
    assert.ok(r.body.error.length > 10);
  };
  await bad({ playUrl: "javascript:alert(1)" }, "playUrl");
  await bad({ playUrl: "ftp://example.com/game.zip" }, "playUrl");
  await bad({ playUrl: "https://user:pass@example.com" }, "playUrl");
  await bad({ playUrl: "" }, "playUrl"); // a link is needed unless it's a Minecraft server
  await bad({ title: "x".repeat(61) }, "title");
  await bad({ title: "   " }, "title");
  await bad({ trailerUrl: "https://vimeo.com/123" }, "trailerUrl");
  await bad({ trailerUrl: "http://www.youtube.com/watch?v=abc" }, "trailerUrl");
  await bad({ trailerUrl: "https://youtube.com.evil.example/watch?v=abc" }, "trailerUrl");
  await bad({ tags: ["pvp", "made-up"] }, "tags");
  await bad({ tags: ["pvp", "rpg", "story", "co-op", "survival", "horror"] }, "tags");
  await bad({ icon: "creeper-face" }, "icon");
  await bad({ accent: "neon" }, "accent");
  await bad({ platform: "xbox" }, "platform");
  await bad({ platform: "minecraft-server", playUrl: "" }, "serverAddress");
  for (const address of ["play example.com", "localhost", "1.2.3.4:99999", "http://play.example.com", "play.example.com:"]) {
    await bad({ platform: "minecraft-server", serverAddress: address }, "serverAddress");
  }

  // Minecraft servers need an address but no link; other platforms drop the address.
  // (A second account, as the first has used up its creates for this minute.)
  ({ cookie } = signIn("checker-2@example.com"));
  const server = await create(cookie, { platform: "minecraft-server", playUrl: "", serverAddress: "Play.Example.com:25565", trailerUrl: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal(server.serverAddress, "play.example.com:25565");
  assert.equal(server.playUrl, null);
  assert.equal(server.trailerUrl, "https://youtu.be/dQw4w9WgXcQ");
  const moved = await api(`/api/games/${server.id}`, { method: "PATCH", cookie, body: { platform: "steam", playUrl: "https://store.steampowered.com/app/1" } });
  assert.equal(moved.body.game.serverAddress, null);
  const ip = await create(cookie, { platform: "minecraft-server", playUrl: "", serverAddress: "203.0.113.7" });
  assert.equal(ip.serverAddress, "203.0.113.7");
});

test("each account can have up to 10 games, and only adults can mark one 18+", async () => {
  const teen = signIn("prolific@example.com");
  const r = await api("/api/games", { method: "POST", cookie: teen.cookie, body: valid({ adultOnly: true }) });
  assert.equal(r.status, 403);
  assert.equal(r.body.needs, "adult");
  for (let i = 0; i < 10; i++) await create(teen.cookie, { title: `Game ${i + 1}` });
  const full = await api("/api/games", { method: "POST", cookie: teen.cookie, body: valid() });
  assert.equal(full.status, 409);
  assert.match(full.body.error, /up to 10 games/);
});

test("the shop's checkout refuses game launches and points to My games", async () => {
  const { cookie } = signIn("shopper@example.com");
  const r = await api("/api/checkout", { method: "POST", cookie, body: { product: "launch" } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /\/my-games/);
  const w = await api("/api/wallet/pay", { method: "POST", cookie, body: { product: "launch" } });
  assert.equal(w.status, 400);
});

test("launching starts a $1-a-month subscription Checkout tied to the game", async () => {
  stripe = installFakeStripe();
  const { cookie } = signIn("launcher@example.com");
  const g = await create(cookie);
  const r = await api(`/api/games/${g.id}/launch`, { method: "POST", cookie, body: {} });
  assert.equal(r.status, 200);
  assert.match(r.body.url, /^https:\/\/checkout\.stripe\.com\//);

  const { params } = stripe.lastCheckout();
  assert.equal(params.mode, "subscription");
  assert.equal(params.payment_method_types, undefined);
  assert.deepEqual(params.metadata, { kind: "order", order_id: String(r.body.orderId), game_id: String(g.id) });
  assert.deepEqual(params.subscription_data.metadata, params.metadata);
  assert.equal(params.line_items[0].price_data.unit_amount, "100");
  assert.equal(params.line_items[0].price_data.recurring.interval, "month");
  assert.match(params.custom_text.submit.message, /end of the month you've paid for/);
  assert.match(params.custom_text.submit.message, /isn't refunded/);
  assert.match(params.success_url, new RegExp(`/my-games\\?launched=${g.id}$`));
  assert.match(params.integration_identifier, /^forgecenter-launch-[a-z]{8}$/);

  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(r.body.orderId);
  assert.deepEqual([order.product, order.amount, order.monthly, order.status], ["launch", 0, 100, "awaiting_payment"]);
  const before = await mine(cookie, g.id);
  assert.equal(before.orderId, order.id);
  assert.equal(before.status, "checkout");
  assert.equal(before.live, false);
});

test("a paid launch puts the game on the games page, once", async () => {
  stripe = installFakeStripe();
  const { cookie } = signIn("live@example.com");
  const g = await create(cookie);
  emails.length = 0;
  const { session, orderId } = await launchAndPay(cookie, g.id);

  const listed = (await directory()).find(x => x.id === g.id);
  assert.equal(listed.title, "Sky Wars");
  assert.equal(listed.creator, "live");
  assert.ok(listed.launchedAt);
  assert.equal((await api(`/api/games/${g.id}`)).status, 200);
  assert.equal((await mine(cookie, g.id)).status, "live");
  // Nothing for the site owner to do, so the order is done; the email says the game is live.
  assert.equal(db.prepare("SELECT status FROM orders WHERE id = ?").get(orderId).status, "delivered");
  await settle();
  const mail = emails.find(m => m.to[0] === "live@example.com");
  assert.equal(mail.subject, "Your game is live");
  assert.doesNotMatch(mail.text, /brief/);

  // A replayed event changes nothing, and a live game can't start another launch.
  await event("checkout.session.completed", { ...session, status: "complete", payment_status: "paid", subscription: "sub_other" });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE product = 'launch' AND user_id = (SELECT user_id FROM games WHERE id = ?)").get(g.id).n, 1);
  const again = await api(`/api/games/${g.id}/launch`, { method: "POST", cookie, body: {} });
  assert.equal(again.status, 409);

  // Platform filter and search.
  assert.ok((await directory("?platform=web")).some(x => x.id === g.id));
  assert.ok(!(await directory("?platform=roblox")).some(x => x.id === g.id));
  assert.ok((await directory("?q=floating")).some(x => x.id === g.id));
  assert.ok(!(await directory("?q=zzz-nothing")).some(x => x.id === g.id));
  assert.equal((await api("/api/games?platform=xbox")).status, 400);
});

test("the public never sees creators' emails or orders", async () => {
  stripe = installFakeStripe();
  const { cookie } = signIn("private-maker@example.com");
  const g = await create(cookie);
  await launchAndPay(cookie, g.id);
  for (const body of [(await api("/api/games")).body, (await api(`/api/games/${g.id}`)).body]) {
    const json = JSON.stringify(body);
    assert.doesNotMatch(json, /private-maker@example\.com/);
    assert.doesNotMatch(json, /orderId|order_id|stripe|sub_launch/i);
  }
});

test("the game drops off when its subscription ends, and can be launched again", async () => {
  stripe = installFakeStripe();
  const { cookie } = signIn("lapsed@example.com");
  const g = await create(cookie);
  const { sub, orderId } = await launchAndPay(cookie, g.id);
  await event("customer.subscription.deleted", { ...sub, status: "canceled" });
  assert.ok(!(await directory()).some(x => x.id === g.id));
  assert.equal((await api(`/api/games/${g.id}`)).status, 404);
  assert.equal((await mine(cookie, g.id)).status, "ended");

  // Relaunching makes a new order.
  const second = await launchAndPay(cookie, g.id);
  assert.notEqual(second.orderId, orderId);
  assert.equal((await mine(cookie, g.id)).status, "live");
  assert.equal((await mine(cookie, g.id)).orderId, second.orderId);
});

test("a failed renewal takes the game off until it's paid", async () => {
  stripe = installFakeStripe();
  const { cookie } = signIn("overdue@example.com");
  const g = await create(cookie);
  const { sub } = await launchAndPay(cookie, g.id);
  await event("invoice.payment_failed", { id: "in_fail", parent: { subscription_details: { subscription: sub.id } } });
  assert.ok(!(await directory()).some(x => x.id === g.id));
  assert.equal((await mine(cookie, g.id)).status, "overdue");
  const relaunch = await api(`/api/games/${g.id}/launch`, { method: "POST", cookie, body: {} });
  assert.equal(relaunch.status, 409);
  assert.equal(relaunch.body.needs, "billing");

  await event("invoice.paid", { id: "in_paid", parent: { subscription_details: { subscription: sub.id } } });
  assert.ok((await directory()).some(x => x.id === g.id));
  assert.equal((await mine(cookie, g.id)).status, "live");
});

test("cancelling keeps the game up until the paid month ends; resuming undoes it", async () => {
  stripe = installFakeStripe();
  const { cookie } = signIn("canceller@example.com");
  const g = await create(cookie);
  const { sub } = await launchAndPay(cookie, g.id);
  const periodEnd = new Date(sub.items.data[0].current_period_end * 1000).toISOString();

  // It can't be deleted while it still renews.
  assert.equal((await api(`/api/games/${g.id}`, { method: "DELETE", cookie, body: {} })).status, 409);

  const c = await api(`/api/games/${g.id}/cancel`, { method: "POST", cookie, body: {} });
  assert.equal(c.status, 200);
  const update = stripe.state.requests.find(r => r.method === "POST" && r.path === `/v1/subscriptions/${sub.id}`);
  assert.equal(update.body.cancel_at_period_end, "true");
  assert.equal(c.body.game.status, "ending");
  assert.equal(c.body.game.cancelAtPeriodEnd, true);
  assert.equal(c.body.game.periodEnd, periodEnd);
  assert.ok((await directory()).some(x => x.id === g.id), "still live until the month ends");

  const r = await api(`/api/games/${g.id}/resume`, { method: "POST", cookie, body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.game.status, "live");
  assert.equal(stripe.state.subscriptions.get(sub.id).cancel_at_period_end, false);

  // Cancel again; when the month runs out Stripe deletes the subscription and the game goes.
  await api(`/api/games/${g.id}/cancel`, { method: "POST", cookie, body: {} });
  await event("customer.subscription.updated", { ...stripe.state.subscriptions.get(sub.id) });
  assert.equal((await mine(cookie, g.id)).status, "ending");
  await event("customer.subscription.deleted", { ...stripe.state.subscriptions.get(sub.id), status: "canceled" });
  assert.ok(!(await directory()).some(x => x.id === g.id));
  assert.equal((await api(`/api/games/${g.id}/resume`, { method: "POST", cookie, body: {} })).status, 409);
  assert.equal((await api(`/api/games/${g.id}`, { method: "DELETE", cookie, body: {} })).status, 200);
});

test("cancelling or resuming in the Stripe billing portal shows up on My games", async () => {
  stripe = installFakeStripe();
  const { cookie } = signIn("portal@example.com");
  const g = await create(cookie);
  const { sub } = await launchAndPay(cookie, g.id);
  const end = Math.floor(Date.now() / 1000) + 10 * 24 * 3600;
  await event("customer.subscription.updated", { ...sub, cancel_at_period_end: true, items: { data: [{ current_period_end: end }] } });
  let game = await mine(cookie, g.id);
  assert.equal(game.status, "ending");
  assert.equal(game.periodEnd, new Date(end * 1000).toISOString());
  await event("customer.subscription.updated", { ...sub, cancel_at_period_end: false, items: { data: [{ current_period_end: end }] } });
  game = await mine(cookie, g.id);
  assert.equal(game.status, "live");
  assert.equal(game.cancelAtPeriodEnd, false);
});

test("the page catches up with a paid checkout before the webhook arrives", async () => {
  stripe = installFakeStripe();
  const { cookie } = signIn("early-launch@example.com");
  const g = await create(cookie);
  await api(`/api/games/${g.id}/launch`, { method: "POST", cookie, body: {} });
  const session = stripe.lastCheckout();
  Object.assign(stripe.state.sessions.get(session.id), { status: "complete", payment_status: "paid", subscription: "sub_early" });
  assert.equal((await mine(cookie, g.id)).status, "live");
});

test("launching again while an earlier checkout is open closes it first", async () => {
  stripe = installFakeStripe();
  const { cookie } = signIn("twice@example.com");
  const g = await create(cookie);
  const first = await api(`/api/games/${g.id}/launch`, { method: "POST", cookie, body: {} });
  const firstSession = stripe.lastCheckout();
  const second = await api(`/api/games/${g.id}/launch`, { method: "POST", cookie, body: {} });
  assert.equal(second.status, 200);
  assert.deepEqual(stripe.state.expired, [firstSession.id]);
  assert.equal(db.prepare("SELECT status FROM orders WHERE id = ?").get(first.body.orderId).status, "expired");
  assert.equal((await mine(cookie, g.id)).orderId, second.body.orderId);
});

test("a launch paid after its game was deleted stops renewing", async () => {
  stripe = installFakeStripe();
  const { cookie } = signIn("orphan@example.com");
  const g = await create(cookie);
  await api(`/api/games/${g.id}/launch`, { method: "POST", cookie, body: {} });
  const session = stripe.lastCheckout();
  const sub = stripe.addSubscription("sub_orphan", { metadata: session.metadata });
  db.prepare("DELETE FROM games WHERE id = ?").run(g.id);
  const res = await event("checkout.session.completed", { ...session, status: "complete", payment_status: "paid", subscription: sub.id });
  assert.equal(res.status, 200);
  assert.equal(stripe.state.subscriptions.get(sub.id).cancel_at_period_end, true);
});

test("a second paid launch for a game that's already live stops renewing", async () => {
  stripe = installFakeStripe();
  const { cookie } = signIn("double-pay@example.com");
  const g = await create(cookie);
  // Two checkouts open at once (two launches racing): the first is never closed.
  const first = await api(`/api/games/${g.id}/launch`, { method: "POST", cookie, body: {} });
  const firstSession = stripe.lastCheckout();
  db.prepare("UPDATE orders SET status = 'expired' WHERE id = ?").run(first.body.orderId);
  const { orderId } = await launchAndPay(cookie, g.id);
  stripe.addSubscription("sub_double", { metadata: firstSession.metadata });
  const res = await event("checkout.session.completed", { ...firstSession, status: "complete", payment_status: "paid", subscription: "sub_double" });
  assert.equal(res.status, 200);
  assert.equal(stripe.state.subscriptions.get("sub_double").cancel_at_period_end, true);
  assert.equal((await mine(cookie, g.id)).orderId, orderId);
  assert.equal((await mine(cookie, g.id)).status, "live");
});

test("18+ games are hidden from teens and visitors", async () => {
  stripe = installFakeStripe();
  const adult = signIn("grown-maker@example.com", undefined, { age: "adult" });
  const teen = signIn("young-player@example.com");
  const viewer = signIn("grown-player@example.com", undefined, { age: "adult" });
  const g = await create(adult.cookie, { title: "Midnight Asylum", adultOnly: true, tags: ["horror"] });
  assert.equal(g.adultOnly, true);
  await launchAndPay(adult.cookie, g.id);

  for (const cookie of [teen.cookie, undefined]) {
    const shown = (await directory("", cookie)).find(x => x.id === g.id);
    assert.deepEqual(shown, { id: g.id, adultOnly: true, restricted: true });
    assert.deepEqual((await api(`/api/games/${g.id}`, { cookie })).body.game, { id: g.id, adultOnly: true, restricted: true });
    assert.ok(!(await directory("?q=asylum", cookie)).some(x => x.id === g.id));
  }
  assert.equal((await directory("", viewer.cookie)).find(x => x.id === g.id).title, "Midnight Asylum");
  assert.equal((await api(`/api/games/${g.id}`, { cookie: viewer.cookie })).body.game.title, "Midnight Asylum");
  // A teen can't turn their own game 18+ either.
  const own = await create(teen.cookie);
  assert.equal((await api(`/api/games/${own.id}`, { method: "PATCH", cookie: teen.cookie, body: { adultOnly: true } })).status, 403);
});

test("the site owner can take a game down, and then it's gone for the public", async () => {
  stripe = installFakeStripe();
  const maker = signIn("rulebreaker@example.com");
  const owner = signIn("owner@example.com");
  const g = await create(maker.cookie);
  await launchAndPay(maker.cookie, g.id);
  assert.equal((await api(`/api/admin/games/${g.id}`, { method: "PATCH", cookie: maker.cookie, body: { hidden: true } })).status, 403);
  assert.equal((await api(`/api/admin/games/${g.id}`, { method: "PATCH", cookie: owner.cookie, body: { hidden: "yes" } })).status, 400);
  const hid = await api(`/api/admin/games/${g.id}`, { method: "PATCH", cookie: owner.cookie, body: { hidden: true } });
  assert.equal(hid.status, 200);
  assert.equal(hid.body.game.hidden, true);

  assert.equal((await api(`/api/games/${g.id}`)).status, 404);
  assert.ok(!(await directory()).some(x => x.id === g.id));
  assert.equal((await mine(maker.cookie, g.id)).status, "hidden");
  assert.equal((await api(`/api/games/${g.id}`, { cookie: owner.cookie })).body.canModerate, true);
  assert.ok((await api("/api/admin/games", { cookie: owner.cookie })).body.games.some(x => x.id === g.id && x.hidden));

  await api(`/api/admin/games/${g.id}`, { method: "PATCH", cookie: owner.cookie, body: { hidden: false } });
  assert.equal((await api(`/api/games/${g.id}`)).status, 200);
});

test("the games pages are served, and only the public ones are listed for search engines", async () => {
  const page = async path => (await fetch(url(path))).text();
  for (const path of ["/games", "/game"]) assert.match(await page(path), /og:image/, path);
  assert.match(await page("/my-games"), /<meta name="robots" content="noindex">/);
  const sitemap = await page("/sitemap.xml");
  assert.match(sitemap, /\/games<\/loc>/);
  assert.doesNotMatch(sitemap, /my-games/);
});
