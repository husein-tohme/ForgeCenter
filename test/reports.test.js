import { test } from "node:test";
import assert from "node:assert/strict";
import { api, db, signIn, makeOrder } from "./helpers.js";
import { registerReportTarget } from "../src/reports.js";

// A live showcase listing owned by `user`.
function listing(user, title = "Cool server") {
  const order = makeOrder(user.id, "showcase", "paid");
  return Number(db.prepare(`INSERT INTO showcase (user_id, order_id, title, url, description, status, created_at)
    VALUES (?, ?, ?, 'https://example.com/server', 'Come play', 'approved', 'now')`).run(user.id, order, title).lastInsertRowid);
}
const report = (cookie, body) => api("/api/reports", { method: "POST", cookie, body: { type: "listing", reason: "scam", ...body } });

test("reports are checked, and one open report per person and listing", async () => {
  const seller = signIn("seller@example.com");
  const me = signIn("reporter@example.com");
  const id = listing(seller.user);

  assert.equal((await report(null, { id })).status, 401);
  assert.equal((await report(me.cookie, { id, reason: "because" })).status, 400);
  assert.equal((await report(me.cookie, { id, type: "planet" })).status, 400);
  assert.equal((await report(me.cookie, { id: { $gt: 1 } })).status, 400);
  assert.equal((await report(me.cookie, { id, details: "x".repeat(1001) })).status, 400);
  assert.equal((await report(seller.cookie, { id })).status, 400); // your own listing

  const ok = await report(me.cookie, { id: String(id), details: "Asks for your password on the site." });
  assert.equal(ok.status, 201);
  const again = await report(me.cookie, { id, reason: "spam" });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /already reported/);
  // The same listing written another way is still the same listing.
  for (const other of [`0${id}`, `00${id}`, `${id}.0`]) assert.notEqual((await report(me.cookie, { id: other })).status, 201, other);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ?").get(me.user.id).n, 1);

  const row = db.prepare("SELECT * FROM reports WHERE target_id = ?").get(String(id));
  assert.equal(row.reporter_id, me.user.id);
  assert.equal(row.status, "open");
  assert.equal(row.details, "Asks for your password on the site.");

  // Teens can report too; it's the birthday question that has to be answered first.
  const fresh = signIn("fresh@example.com", "fresh", { age: null });
  assert.equal((await report(fresh.cookie, { id })).body.needs, "birthday");
});

test("reporting something that doesn't exist or isn't public is a 404", async () => {
  const seller = signIn("seller2@example.com");
  const me = signIn("reporter2@example.com");
  assert.equal((await report(me.cookie, { id: 999999 })).status, 404);
  const id = listing(seller.user, "Pending one");
  db.prepare("UPDATE showcase SET status = 'pending' WHERE id = ?").run(id);
  assert.equal((await report(me.cookie, { id })).status, 404);
});

test("reports are rate limited to 10 an hour per account", async () => {
  const seller = signIn("seller3@example.com");
  const me = signIn("spammy@example.com");
  const ids = Array.from({ length: 11 }, (_, i) => listing(seller.user, `Listing ${i}`));
  for (const id of ids.slice(0, 10)) assert.equal((await report(me.cookie, { id })).status, 201);
  assert.equal((await report(me.cookie, { id: ids[10] })).status, 429);
});

test("other features can register what can be reported", async () => {
  registerReportTarget("widget", { exists: id => id === "w1", describe: () => ({ title: "Widget", url: "javascript:alert(1)", ownerUserId: null }) });
  const owner = signIn("owner@example.com");
  const me = signIn("widgets@example.com");
  assert.equal((await report(me.cookie, { type: "widget", id: "w2" })).status, 404);
  assert.equal((await report(me.cookie, { type: "widget", id: "w1", reason: "other" })).status, 201);
  const r = (await api("/api/admin/reports", { cookie: owner.cookie })).body.reports.find(x => x.type === "widget");
  assert.equal(r.target.title, "Widget");
  assert.equal(r.target.url, null); // only http(s) links reach the owner panel
  assert.equal(r.canHide, false);
  assert.equal((await api(`/api/admin/reports/${r.id}`, { method: "PATCH", cookie: owner.cookie, body: { status: "actioned", hide: true } })).status, 400);
});

test("only the owner can review reports, hide listings and close reports", async () => {
  const owner = signIn("owner@example.com");
  const seller = signIn("seller4@example.com");
  const me = signIn("reporter4@example.com");
  const id = listing(seller.user, "Free diamonds");
  await report(me.cookie, { id, details: "Wants card details" });

  for (const who of [null, me.cookie, seller.cookie]) {
    assert.notEqual((await api("/api/admin/reports", { cookie: who })).status, 200);
    assert.notEqual((await api("/api/admin/reports/1", { method: "PATCH", cookie: who, body: { status: "dismissed" } })).status, 200);
    assert.notEqual((await api(`/api/admin/users/${seller.user.id}/suspend`, { method: "POST", cookie: who, body: { reason: "x" } })).status, 200);
  }

  const list = await api("/api/admin/reports?status=open", { cookie: owner.cookie });
  assert.equal(list.status, 200);
  const r = list.body.reports.find(x => x.targetId === String(id));
  assert.equal(r.target.title, "Free diamonds");
  assert.equal(r.target.url, "https://example.com/server");
  assert.equal(r.target.owner.id, seller.user.id);
  assert.equal(r.reporter.id, me.user.id);
  assert.equal(r.reasonName, "Scam or phishing");
  assert.equal(r.canHide, true);
  assert.ok((await api("/api/admin/overview", { cookie: owner.cookie })).body.attention.reportsOpen >= 1);

  assert.equal((await api(`/api/admin/reports/${r.id}`, { method: "PATCH", cookie: owner.cookie, body: { status: "gone" } })).status, 400);
  assert.equal((await api("/api/admin/reports/999999", { method: "PATCH", cookie: owner.cookie, body: { status: "dismissed" } })).status, 404);
  const done = await api(`/api/admin/reports/${r.id}`, { method: "PATCH", cookie: owner.cookie, body: { status: "actioned", hide: true, note: "Phishing" } });
  assert.equal(done.status, 200);
  assert.equal(done.body.report.status, "actioned");
  assert.equal(done.body.report.resolvedNote, "Phishing");
  assert.equal(done.body.report.canHide, false);
  assert.equal(db.prepare("SELECT status FROM showcase WHERE id = ?").get(id).status, "hidden");
  assert.ok(!(await api("/api/showcase")).body.listings.some(l => l.id === id));

  const dismissed = await api("/api/admin/reports?status=actioned", { cookie: owner.cookie });
  assert.ok(dismissed.body.reports.some(x => x.id === r.id));
  // A closed report doesn't stop a new one.
  db.prepare("UPDATE showcase SET status = 'approved' WHERE id = ?").run(id);
  assert.equal((await report(me.cookie, { id })).status, 201);
});

test("a suspension blocks the account, but /api/me and support tickets still work", async () => {
  const owner = signIn("owner@example.com");
  const bad = signIn("rulebreaker@example.com");
  const id = listing(bad.user, "Totally legit");
  assert.ok((await api("/api/showcase")).body.listings.some(l => l.id === id));

  assert.equal((await api(`/api/admin/users/${bad.user.id}/suspend`, { method: "POST", cookie: owner.cookie, body: { reason: " " } })).status, 400);
  assert.equal((await api("/api/admin/users/999999/suspend", { method: "POST", cookie: owner.cookie, body: { reason: "x" } })).status, 404);
  const s = await api(`/api/admin/users/${bad.user.id}/suspend`, { method: "POST", cookie: owner.cookie, body: { reason: "Selling hacked clients" } });
  assert.equal(s.status, 200);
  assert.equal(s.body.user.suspended, true);

  for (const path of ["/api/orders", "/api/wallet", "/api/showcase/mine", "/api/tutor/usage"]) {
    const r = await api(path, { cookie: bad.cookie });
    assert.equal(r.status, 403, path);
    assert.equal(r.body.needs, "suspended");
    assert.match(r.body.error, /Selling hacked clients/);
    assert.match(r.body.error, /support ticket/);
  }
  assert.equal((await api("/api/reports", { method: "POST", cookie: bad.cookie, body: { type: "listing", id, reason: "spam" } })).body.needs, "suspended");

  const me = await api("/api/me", { cookie: bad.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.suspended.reason, "Selling hacked clients");
  assert.ok(me.body.user.suspended.at);

  // The listing is gone from the public showcase, and can't be reported while hidden.
  assert.ok(!(await api("/api/showcase")).body.listings.some(l => l.id === id));
  assert.equal((await report(owner.cookie, { id })).status, 404);

  // Appeals: tickets still work.
  const t = await api("/api/support", { method: "POST", cookie: bad.cookie, body: { subject: "Appeal", category: "account", body: "I didn't do it." } });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal((await api("/api/support", { cookie: bad.cookie })).status, 200);
  assert.equal((await api(`/api/support/${t.body.ticket.id}`, { cookie: bad.cookie })).status, 200);
  assert.equal((await api(`/api/support/${t.body.ticket.id}/messages`, { method: "POST", cookie: bad.cookie, body: { body: "More details." } })).status, 200);

  const list = await api("/api/admin/users/suspended", { cookie: owner.cookie });
  assert.ok(list.body.users.some(u => u.id === bad.user.id && u.reason === "Selling hacked clients"));

  // Lifting it restores everything.
  assert.equal((await api(`/api/admin/users/${bad.user.id}/unsuspend`, { method: "POST", cookie: owner.cookie, body: {} })).status, 200);
  assert.equal((await api("/api/orders", { cookie: bad.cookie })).status, 200);
  assert.equal((await api("/api/me", { cookie: bad.cookie })).body.user.suspended, null);
  assert.ok((await api("/api/showcase")).body.listings.some(l => l.id === id));
});

test("owner accounts can't be suspended", async () => {
  const owner = signIn("owner@example.com");
  process.env.ADMIN_EMAILS = "owner@example.com,second@example.com";
  try {
    const second = signIn("second@example.com");
    const r = await api(`/api/admin/users/${second.user.id}/suspend`, { method: "POST", cookie: owner.cookie, body: { reason: "Testing" } });
    assert.equal(r.status, 403);
    const self = await api(`/api/admin/users/${owner.user.id}/suspend`, { method: "POST", cookie: owner.cookie, body: { reason: "Testing" } });
    assert.equal(self.status, 400);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE suspended_at IS NOT NULL AND id IN (?, ?)").get(owner.user.id, second.user.id).n, 0);

    // Someone suspended before their address was added to ADMIN_EMAILS can still be let back in.
    const later = signIn("later@example.com");
    await api(`/api/admin/users/${later.user.id}/suspend`, { method: "POST", cookie: owner.cookie, body: { reason: "Spam" } });
    process.env.ADMIN_EMAILS = "owner@example.com,second@example.com,later@example.com";
    assert.equal((await api("/api/admin/reports", { cookie: later.cookie })).body.needs, "suspended");
    assert.equal((await api(`/api/admin/users/${later.user.id}/unsuspend`, { method: "POST", cookie: owner.cookie, body: {} })).status, 200);
    assert.equal((await api("/api/admin/reports", { cookie: later.cookie })).status, 200);
  } finally {
    process.env.ADMIN_EMAILS = "owner@example.com";
  }
});

test("deleting a reporter's account keeps the report without them", async () => {
  const seller = signIn("seller5@example.com");
  const me = signIn("leaver@example.com");
  const id = listing(seller.user);
  await report(me.cookie, { id });
  assert.equal((await api("/api/me", { method: "DELETE", cookie: me.cookie, body: {} })).status, 200);
  const row = db.prepare("SELECT reporter_id FROM reports WHERE target_id = ? ORDER BY id DESC").get(String(id));
  assert.equal(row.reporter_id, null);
});
