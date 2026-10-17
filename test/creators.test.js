import { test } from "node:test";
import assert from "node:assert/strict";
import { api, db, sendWebhook, signIn, url } from "./helpers.js";

let n = 0;
// A fresh account for each check, so per-person rate limits never get in the way.
const person = (age = "teen", name = null) => {
  const s = signIn(`creator${++n}@example.com`, `creator-${n}`, { age });
  if (name) db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, s.user.id);
  return s;
};
const save = (cookie, body) => api("/api/creators/mine", { method: "PUT", cookie, body: { bio: "", links: [], support: {}, ...body } });
const profile = (handle, cookie) => api(`/api/creators/${handle}`, { cookie });

function addOrder(userId, { product = "ai", amount = 10000, monthly = 0, status = "awaiting_payment", paidWith = null } = {}) {
  return Number(db.prepare(`INSERT INTO orders (user_id, product, amount, monthly, status, paid_with, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'now', 'now')`).run(userId, product, amount, monthly, status, paidWith).lastInsertRowid);
}
let eventId = 0;
const cardPaid = orderId => sendWebhook({ id: `evt_creators_${++eventId}`, type: "checkout.session.completed", data: { object: {
  id: `cs_creators_${eventId}`, object: "checkout.session", mode: "payment", status: "complete", payment_status: "paid",
  metadata: { kind: "order", order_id: String(orderId) } } } });
const rewardsFor = userId => db.prepare("SELECT * FROM wallet_entries WHERE user_id = ? AND kind = 'reward' ORDER BY id").all(userId);
const addCreation = (userId, kind, name, modrinthUrl = null) => db.prepare(`INSERT INTO mods (user_id, kind, name, modrinth_url, created_at)
  VALUES (?, ?, ?, ?, 'now')`).run(userId, kind, name, modrinthUrl);
const addListing = (userId, title, adultOnly = false) => {
  const orderId = addOrder(userId, { product: "showcase", amount: 1000, status: "paid" });
  db.prepare(`INSERT INTO showcase (user_id, order_id, title, url, description, status, adult_only, created_at)
    VALUES (?, ?, ?, 'https://play.example.com', 'A server', 'approved', ?, 'now')`).run(userId, orderId, title, adultOnly ? 1 : 0);
};

test("creators claim a handle that follows the rules and isn't reserved or taken", async () => {
  assert.equal((await save(undefined, { handle: "nobody" })).status, 401);
  const fresh = signIn("no-birthday@example.com", "no-birthday", { age: null });
  assert.equal((await save(fresh.cookie, { handle: "fresh-face" })).body.needs, "birthday");

  const a = person();
  for (const handle of ["ab", "a".repeat(25), "-steve", "steve-", "ste ve", "stéve", "st_eve", ""]) {
    const r = await save(a.cookie, { handle });
    assert.equal(r.status, 400, handle);
    assert.equal(r.body.field, "handle");
  }
  const b = person();
  for (const handle of ["admin", "support", "forgecenter", "creators", "mine", "official-steve", "forgecenter-team", "the-forgecenter-fan", "steve-admin"]) {
    const r = await save(b.cookie, { handle });
    assert.equal(r.status, 400, handle);
    assert.match(r.body.error, /reserved/, handle);
  }

  const ok = await save(a.cookie, { handle: "  Steve-Builds " });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.profile.handle, "steve-builds");
  assert.equal(ok.body.profile.url, "/c/steve-builds");
  assert.equal(ok.body.referral.link, `${url("")}/?ref=steve-builds`);

  const taken = await save(b.cookie, { handle: "steve-builds" });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.field, "handle");
  assert.deepEqual((await api("/api/creators/check?handle=steve-builds", { cookie: b.cookie })).body.ok, false);
  assert.equal((await api("/api/creators/check?handle=steve-builds", { cookie: a.cookie })).body.ok, true); // it's theirs
  assert.match((await api("/api/creators/check?handle=admin", { cookie: b.cookie })).body.error, /reserved/);

  // Changing handle frees the old one.
  assert.equal((await save(a.cookie, { handle: "steve-makes" })).status, 200);
  assert.equal((await profile("steve-builds")).status, 404);
  assert.equal((await save(b.cookie, { handle: "steve-builds" })).status, 200);
});

test("links must be web addresses, and support links must be https on that service's own site", async () => {
  const bad = async (body, field) => {
    const { cookie } = person("adult");
    const r = await save(cookie, { handle: `links-${n}`, ...body });
    assert.equal(r.status, 400, JSON.stringify(body));
    if (field) assert.equal(r.body.field, field, JSON.stringify(body));
    return r;
  };
  for (const link of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>hi</b>", "ftp://files.example.com", "//evil.example.com", "https://", "https://user:pw@example.com"]) {
    await bad({ links: [{ label: "Mine", url: link }] }, "link-0");
  }
  await bad({ links: [{ label: "x".repeat(31), url: "https://example.com" }] }, "link-0");
  await bad({ links: Array.from({ length: 7 }, (_, i) => ({ label: `L${i}`, url: `https://example.com/${i}` })) }, "links");
  await bad({ bio: "b".repeat(301) }, "bio");

  const wrong = {
    paypal: ["https://paypal.me.evil.com/steve", "http://paypal.me/steve", "https://www.paypal.com/donate", "https://paypal.me/"],
    kofi: ["javascript:alert(1)", "https://ko-fi.com:8443/steve", "https://ko-fi.evil.com/steve"],
    patreon: ["https://patreon.com", "https://patreon.com.evil.com/steve"],
    buymeacoffee: ["https://buymeacoffee.co/steve"],
    github: ["https://github.com/steve", "https://github.com/sponsors/steve/../../evil"],
    stripe: ["https://checkout.stripe.com/c/pay/x", "https://evil.com/buy.stripe.com/x"],
  };
  for (const [kind, urls] of Object.entries(wrong)) {
    for (const u of urls) {
      const r = await bad({ support: { [kind]: u } }, `support-${kind}`);
      assert.match(r.body.error, /doesn't look right/);
    }
  }

  const { cookie } = person("adult");
  const support = {
    paypal: "https://www.paypal.com/paypalme/steve", kofi: "https://ko-fi.com/steve", patreon: "https://www.patreon.com/c/steve",
    buymeacoffee: "https://buymeacoffee.com/steve", github: "https://github.com/sponsors/steve", stripe: "https://buy.stripe.com/test_abc123",
  };
  const ok = await save(cookie, { handle: "good-links", bio: "I make maps.\nAnd mods.",
    links: [{ label: "YouTube", url: "https://www.youtube.com/@steve" }, { label: "", url: "http://example.com/blog" }, { label: "", url: "  " }], support });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const page = (await profile("good-links")).body.creator;
  assert.deepEqual(page.links, [{ label: "YouTube", url: "https://www.youtube.com/@steve" }, { label: "example.com", url: "http://example.com/blog" }]);
  assert.deepEqual(page.support.map(s => s.kind), ["paypal", "kofi", "patreon", "buymeacoffee", "github", "stripe"]);
  assert.equal(page.bio, "I make maps.\nAnd mods.");
});

test("only confirmed adults can show support links", async () => {
  const teen = person("teen");
  const r = await save(teen.cookie, { handle: "teen-maker", support: { kofi: "https://ko-fi.com/teen" } });
  assert.equal(r.status, 403);
  assert.equal(r.body.needs, "adult");
  assert.equal((await save(teen.cookie, { handle: "teen-maker", bio: "Hi!" })).status, 200);
  const mine = (await api("/api/creators/mine", { cookie: teen.cookie })).body;
  assert.equal(mine.canAddSupport, false);
  // Even a support link stored before (say, by an older version) isn't shown for a teen.
  db.prepare("UPDATE creator_profiles SET support_links = ? WHERE handle = 'teen-maker'").run(JSON.stringify({ kofi: "https://ko-fi.com/teen" }));
  assert.deepEqual((await profile("teen-maker")).body.creator.support, []);
});

test("a public page shows badges and work, never email, phone, age group, wallet or orders", async () => {
  const c = person("adult", "Steve Stone");
  db.prepare("UPDATE users SET phone = '+15550001234' WHERE id = ?").run(c.user.id);
  db.prepare("INSERT INTO wallet_entries (user_id, amount, kind, note, created_at) VALUES (?, 98765, 'credit', 'test', 'now')").run(c.user.id);
  addCreation(c.user.id, "texturepack", "Cosy Pack");
  addCreation(c.user.id, "modpack", "Skyblock Plus");
  addCreation(c.user.id, "plugin", "Spawn Helper");
  addCreation(c.user.id, "mod", "Ruby Tools", "https://modrinth.com/mod/ruby-tools");
  addCreation(c.user.id, "mod", "Secret Draft");
  addListing(c.user.id, "Steve's Server");
  await save(c.cookie, { handle: "steve-stone", bio: "Hello" });

  for (const viewer of [undefined, person("teen").cookie, person("adult").cookie]) {
    const r = await profile("steve-stone", viewer);
    assert.equal(r.status, 200);
    const text = JSON.stringify(r.body);
    for (const secret of ["@example.com", "5550001234", "98765", "987.65", "ageGroup", "age_group", "wallet", "email", "phone", "orders"]) {
      assert.ok(!text.includes(secret), `${secret} leaked: ${text}`);
    }
    assert.doesNotMatch(text, /"(teen|adult)"/);
    assert.deepEqual(Object.keys(r.body.creator).sort(),
      ["badges", "bio", "canModerate", "creations", "handle", "isOwner", "links", "listings", "memberSince", "name", "picture", "support"]);
  }
  const page = (await profile("steve-stone")).body.creator;
  assert.equal(page.name, "Steve Stone");
  assert.deepEqual(page.badges.map(b => b.key), ["maker", "pixel_artist", "pack_builder", "plugin_smith", "publisher", "showcased", "supporter"]);
  assert.ok(page.badges.every(b => b.name && b.meaning));
  assert.deepEqual(page.creations, [{ name: "Ruby Tools", kind: "mod", url: "https://modrinth.com/mod/ruby-tools" }]);
  assert.equal(page.listings[0].title, "Steve's Server");
  assert.equal((await profile("steve-stone", c.cookie)).body.creator.isOwner, true);

  // WhatsApp accounts are named after the end of their phone number, so the handle shows instead.
  const wa = person("teen", "Player 1234");
  await save(wa.cookie, { handle: "wa-player" });
  assert.equal((await profile("wa-player")).body.creator.name, "wa-player");
});

test("18+ showcase listings on a creator page only show to confirmed adults", async () => {
  const c = person("adult");
  addListing(c.user.id, "Family Server");
  addListing(c.user.id, "Late Night Server", true);
  await save(c.cookie, { handle: "night-owl" });
  const titles = async cookie => (await profile("night-owl", cookie)).body.creator.listings.map(l => l.title);
  assert.deepEqual(await titles(undefined), ["Family Server"]);
  assert.deepEqual(await titles(person("teen").cookie), ["Family Server"]);
  const adult = (await profile("night-owl", person("adult").cookie)).body.creator.listings;
  assert.deepEqual(adult.map(l => [l.title, l.adultOnly]), [["Late Night Server", true], ["Family Server", false]]);
});

test("hidden pages are not found for anyone but their creator and the site owner", async () => {
  const c = person();
  const other = person();
  const owner = signIn("owner@example.com");
  await save(c.cookie, { handle: "hide-me" });

  assert.equal((await api("/api/admin/creators/hide-me", { cookie: other.cookie })).status, 403);
  assert.equal((await api("/api/admin/creators/hide-me", { method: "PATCH", cookie: other.cookie, body: { hidden: true } })).status, 403);
  assert.equal((await api("/api/admin/creators/hide-me", { method: "PATCH", cookie: c.cookie, body: { hidden: true } })).status, 403);
  assert.equal((await api("/api/admin/creators/hide-me", { method: "PATCH", cookie: owner.cookie, body: { hidden: "yes" } })).status, 400);
  assert.equal((await api("/api/admin/creators/nobody-here", { method: "PATCH", cookie: owner.cookie, body: { hidden: true } })).status, 404);
  const hid = await api("/api/admin/creators/hide-me", { method: "PATCH", cookie: owner.cookie, body: { hidden: true } });
  assert.equal(hid.body.creator.hidden, true);
  assert.equal((await api("/api/admin/creators/hide-me", { cookie: owner.cookie })).body.creator.email, c.user.email);

  assert.equal((await profile("hide-me")).status, 404);
  assert.equal((await profile("hide-me", other.cookie)).status, 404);
  assert.equal((await fetch(url("/c/hide-me"))).status, 404);
  const own = await profile("hide-me", c.cookie);
  assert.equal(own.status, 200);
  assert.equal(own.body.creator.hidden, true);
  assert.equal((await profile("hide-me", owner.cookie)).body.creator.canModerate, true);
  assert.equal((await fetch(url("/c/hide-me"), { headers: { cookie: c.cookie } })).status, 200);
  assert.ok(!(await api("/api/creators")).body.creators.some(x => x.handle === "hide-me"));
  // Its referral link stops working too, and the creator can still edit it.
  const newbie = person();
  assert.equal((await api("/api/creators/referral/claim", { method: "POST", cookie: newbie.cookie, body: { code: "hide-me" } })).status, 404);
  assert.equal((await save(c.cookie, { handle: "hide-me", bio: "Still mine" })).status, 200);
  assert.equal((await api("/api/creators/mine", { cookie: c.cookie })).body.profile.hidden, true);
  // Removing the page and making it again must not undo the hide.
  assert.equal((await api("/api/creators/mine", { method: "DELETE", cookie: c.cookie, body: {} })).status, 409);
  assert.equal((await profile("hide-me")).status, 404);
  assert.equal((await save(c.cookie, { handle: "hide-me-again" })).status, 200);
  assert.equal((await profile("hide-me-again")).status, 404);
  assert.equal((await save(c.cookie, { handle: "hide-me", bio: "Still mine" })).status, 200);

  await api("/api/admin/creators/hide-me", { method: "PATCH", cookie: owner.cookie, body: { hidden: false } });
  assert.equal((await profile("hide-me")).body.creator.bio, "Still mine");
});

test("the directory ranks creators by badges, then creations, and shows at most 30", async () => {
  const one = person(), two = person(), three = person();
  addCreation(one.user.id, "mod", "A"); // maker
  addCreation(two.user.id, "texturepack", "B"); // maker, pixel artist
  addCreation(three.user.id, "mod", "C"); addCreation(three.user.id, "mod", "D"); // maker, more creations than one
  await save(one.cookie, { handle: "rank-one" });
  await save(two.cookie, { handle: "rank-two" });
  await save(three.cookie, { handle: "rank-three" });
  const list = (await api("/api/creators?sort=top")).body;
  const order = list.creators.map(c => c.handle).filter(h => h.startsWith("rank-"));
  assert.deepEqual(order, ["rank-two", "rank-three", "rank-one"]);
  const two_ = list.creators.find(c => c.handle === "rank-two");
  assert.deepEqual(two_.badges, ["maker", "pixel_artist"]);
  assert.deepEqual(Object.keys(two_).sort(), ["badges", "bio", "creations", "handle", "name", "picture"]);
  assert.equal(list.badges.length, 10);
  const newest = (await api("/api/creators?sort=new")).body.creators.map(c => c.handle).filter(h => h.startsWith("rank-"));
  assert.deepEqual(newest, ["rank-three", "rank-two", "rank-one"]);

  for (let i = 0; i < 32; i++) {
    const u = person();
    db.prepare("INSERT INTO creator_profiles (user_id, handle, created_at, updated_at) VALUES (?, ?, 'now', 'now')").run(u.user.id, `bulk-${i}`);
  }
  assert.equal((await api("/api/creators")).body.creators.length, 30);
});

test("referral links only count for new accounts without orders, once, and never your own", async () => {
  const ref = person();
  await save(ref.cookie, { handle: "ref-maker" });
  const claim = (cookie, code = "ref-maker") => api("/api/creators/referral/claim", { method: "POST", cookie, body: { code } });

  assert.equal((await claim(undefined)).status, 401);
  assert.match((await claim(ref.cookie)).body.error, /your own/);
  assert.equal((await claim(person().cookie, "no-such-creator")).status, 404);
  assert.equal((await claim(person().cookie, "<script>")).status, 404);

  const old = person();
  db.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 25 * 3600_000).toISOString(), old.user.id);
  const oldTry = await claim(old.cookie);
  assert.equal(oldTry.status, 409);
  assert.match(oldTry.body.error, /last day/);

  const buyer = person();
  addOrder(buyer.user.id, { status: "paid" });
  assert.match((await claim(buyer.cookie)).body.error, /first order/);

  const newbie = person();
  const ok = await claim(newbie.cookie, "REF-Maker");
  assert.equal(ok.status, 200);
  assert.equal(ok.body.creator.handle, "ref-maker");
  assert.equal((await claim(newbie.cookie)).status, 409);
  const elsewhere = person();
  await save(elsewhere.cookie, { handle: "other-ref" });
  assert.match((await claim(newbie.cookie, "other-ref")).body.error, /already linked/);
  assert.equal(db.prepare("SELECT referrer_user_id FROM referrals WHERE referred_user_id = ?").get(newbie.user.id).referrer_user_id, ref.user.id);
  assert.equal((await api("/api/creators/mine", { cookie: ref.cookie })).body.referral.referred, 1);
});

test("a referred customer's first card order earns the referrer a capped share, once", async () => {
  const ref = person();
  await save(ref.cookie, { handle: "earner" });
  const join = async name => {
    const p = person("teen", name);
    assert.equal((await api("/api/creators/referral/claim", { method: "POST", cookie: p.cookie, body: { code: "earner" } })).status, 200);
    return p;
  };

  const ana = await join("Ana Silva");
  const first = addOrder(ana.user.id, { amount: 10000 });
  assert.equal((await cardPaid(first)).status, 200);
  let rewards = rewardsFor(ref.user.id);
  assert.equal(rewards.length, 1);
  assert.equal(rewards[0].amount, 1000); // 10% of $100
  assert.equal(rewards[0].ref, `referral:${first}`);
  assert.equal(rewards[0].note, "Ana's first order through your link");
  assert.equal(rewards[0].order_id, null); // the referrer never sees what was bought

  // A replayed event and a second order add nothing.
  await cardPaid(first);
  const second = addOrder(ana.user.id, { amount: 20000 });
  await cardPaid(second);
  assert.equal(rewardsFor(ref.user.id).length, 1);

  // Big orders are capped at $50, counting the first month of a subscription too.
  const bo = await join("Bo");
  await cardPaid(addOrder(bo.user.id, { product: "website", amount: 100000, monthly: 200 }));
  rewards = rewardsFor(ref.user.id);
  assert.equal(rewards.length, 2);
  assert.equal(rewards[1].amount, 5000);

  const wallet = (await api("/api/wallet", { cookie: ref.cookie })).body;
  assert.equal(wallet.balance, 6000);
  assert.ok(wallet.entries.every(e => e.kind === "reward" && e.orderId === null && e.product === null));
  const mine = (await api("/api/creators/mine", { cookie: ref.cookie })).body;
  assert.deepEqual([mine.referral.referred, mine.referral.rewarded, mine.referral.earnedCents], [2, 2, 6000]);
  assert.deepEqual([mine.referral.percent, mine.referral.capCents], [10, 5000]);
  assert.ok((await profile("earner")).body.creator.badges.some(b => b.key === "recruiter"));

  // The share and the cap come from the environment.
  process.env.REFERRAL_PERCENT = "20";
  process.env.REFERRAL_CAP_CENTS = "1500";
  try {
    const cy = await join("Cy");
    await cardPaid(addOrder(cy.user.id, { amount: 5000 }));
    const dee = await join("Dee");
    await cardPaid(addOrder(dee.user.id, { amount: 50000 }));
    assert.deepEqual(rewardsFor(ref.user.id).slice(2).map(r => r.amount), [1000, 1500]);
  } finally {
    delete process.env.REFERRAL_PERCENT;
    delete process.env.REFERRAL_CAP_CENTS;
  }
});

test("wallet-paid orders never earn a referral reward", async () => {
  const ref = person();
  await save(ref.cookie, { handle: "wallet-ref" });
  const p = person();
  assert.equal((await api("/api/creators/referral/claim", { method: "POST", cookie: p.cookie, body: { code: "wallet-ref" } })).status, 200);
  db.prepare("INSERT INTO wallet_entries (user_id, amount, kind, note, created_at) VALUES (?, 20000, 'credit', 'test', 'now')").run(p.user.id);
  const paid = await api("/api/wallet/pay", { method: "POST", cookie: p.cookie, body: { product: "ai" } });
  assert.equal(paid.status, 200);
  assert.equal(rewardsFor(ref.user.id).length, 0);
  // Their first order was the wallet one, so a later card order doesn't count either.
  await cardPaid(addOrder(p.user.id, { amount: 10000 }));
  assert.equal(rewardsFor(ref.user.id).length, 0);
  assert.equal(db.prepare("SELECT rewarded_order_id FROM referrals WHERE referred_user_id = ?").get(p.user.id).rewarded_order_id, null);
});

test("creator pages are served at /c/<handle> with a safe link preview", async () => {
  const c = person("teen", `Alex <script>alert("x")</script>`);
  await save(c.cookie, { handle: "alex-preview", bio: `Builder of "big" things & more` });
  const r = await fetch(url("/c/Alex-Preview"));
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes(`<link rel="canonical" href="${url("")}/c/alex-preview">`));
  assert.ok(html.includes(`<meta property="og:title" content="Alex &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; (@alex-preview) · ForgeCenter">`));
  assert.ok(html.includes(`content="Builder of &quot;big&quot; things &amp; more"`));
  assert.ok(!html.includes("<script>alert") && !html.includes("%CREATOR_"));

  // "$`" and "$&" in a name or bio are text, not replacement patterns that paste in the page.
  const d = person("teen", "Dollar $` Sign");
  await save(d.cookie, { handle: "dollar-preview", bio: "Costs $& more $'" });
  const dhtml = await (await fetch(url("/c/dollar-preview"))).text();
  assert.ok(dhtml.includes("<title>Dollar $` Sign (@dollar-preview) · ForgeCenter</title>"));
  assert.ok(dhtml.includes(`<meta name="description" content="Costs $&amp; more $&#39;">`));
  assert.equal(dhtml.match(/<!doctype html>/gi).length, 1);

  assert.equal((await fetch(url("/c/nobody-at-all"))).status, 404);
  assert.equal((await fetch(url("/c/..%2f..%2fsrc"))).status, 404);
  assert.equal((await fetch(url("/creator"))).status, 404);
  const dir = await fetch(url("/creators"));
  assert.equal(dir.status, 200);
  assert.ok((await dir.text()).includes(`<link rel="canonical" href="${url("")}/creators">`));
  assert.ok((await (await fetch(url("/sitemap.xml"))).text()).includes(`<loc>${url("")}/creators</loc>`));
});

test("removing a page frees its handle, and deleting the account removes it", async () => {
  const c = person();
  await save(c.cookie, { handle: "short-lived" });
  const removed = await api("/api/creators/mine", { method: "DELETE", cookie: c.cookie, body: {} });
  assert.equal(removed.body.profile, null);
  assert.equal(removed.body.referral.link, null);
  assert.equal((await profile("short-lived")).status, 404);

  const d = person();
  await save(d.cookie, { handle: "short-lived" });
  assert.equal((await api("/api/me", { method: "DELETE", cookie: d.cookie, body: {} })).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM creator_profiles WHERE handle = 'short-lived'").get().n, 0);
});

test("donors and creators with a live game get badges for it", async () => {
  const c = person();
  assert.equal((await save(c.cookie, { handle: "giving-gwen" })).status, 200);
  const t = new Date().toISOString();
  db.prepare(`INSERT INTO donations (user_id, amount, monthly, status, created_at, updated_at, paid_at)
    VALUES (?, 500, 0, 'paid', ?, ?, ?)`).run(c.user.id, t, t, t);
  const orderId = Number(db.prepare(`INSERT INTO orders (user_id, product, amount, status, subscription_status, created_at, updated_at)
    VALUES (?, 'launch', 100, 'delivered', 'active', ?, ?)`).run(c.user.id, t, t).lastInsertRowid);
  db.prepare(`INSERT INTO games (user_id, title, platform, icon, accent, order_id, created_at, updated_at)
    VALUES (?, 'Gwen Quest', 'minecraft', 'gamepad', 'emerald', ?, ?, ?)`).run(c.user.id, orderId, t, t);
  const keys = (await profile("giving-gwen")).body.creator.badges.map(b => b.key);
  assert.ok(keys.includes("donor") && keys.includes("game_launcher"), keys.join());
});
