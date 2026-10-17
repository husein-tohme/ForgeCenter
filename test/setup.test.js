import { test, after } from "node:test";
import assert from "node:assert/strict";
process.env.SECRET_KEY = ["setup-test", "key-that-is-long-enough", "0123456789"].join("-");
delete process.env.GITHUB_CLIENT_ID;
delete process.env.GITHUB_CLIENT_SECRET;
const { api, db, signIn, url } = await import("./helpers.js");
const { setSetupCodeForTests, githubManifest } = await import("../src/setup.js");

// GitHub's manifest conversion, simulated; every other request goes through.
const realFetch = globalThis.fetch;
let conversions = [];
globalThis.fetch = async (input, init) => {
  const href = String(input?.url ?? input);
  if (href.startsWith("https://api.github.com/app-manifests/")) {
    conversions.push({ href, init });
    const fakeSecret = ["gh", "app", "secret", "for-tests"].join("_");
    return new Response(JSON.stringify({ id: 1, slug: "forgecenter-abc", client_id: "Iv1.testclient", client_secret: fakeSecret, html_url: "https://github.com/apps/forgecenter-abc" }), { status: 201 });
  }
  return realFetch(input, init);
};
after(() => { globalThis.fetch = realFetch; });

const start = (body, cookie) => api("/api/setup/github/start", { method: "POST", body, cookie });

test("the manifest asks only for sign-in: our callback, no webhook, no extra permissions", () => {
  const m = githubManifest("https://forgecenter.example");
  assert.deepEqual(m.callback_urls, ["https://forgecenter.example/api/auth/github/callback"]);
  assert.equal(m.redirect_url, "https://forgecenter.example/setup-signin/github/done");
  assert.equal(m.hook_attributes.active, false);
  assert.equal(m.default_permissions, undefined); // GitHub refuses unknown permission names
  assert.ok(m.name.length <= 34);
});

test("one-click GitHub setup: unlocked by the setup code, keys come back from GitHub and switch sign-in on", async () => {
  setSetupCodeForTests("ABCDE-12345");
  assert.equal((await api("/api/setup/status")).body.github, false);
  assert.equal((await start({ code: "WRONG-00000" })).status, 403);
  assert.equal((await start({})).status, 403);

  const r = await start({ code: "abcde-12345" }); // case and spaces don't matter
  assert.equal(r.status, 200, r.body?.error);
  assert.match(r.body.action, /^https:\/\/github\.com\/settings\/apps\/new\?state=[\w-]{20,}$/);
  const state = new URL(r.body.action).searchParams.get("state");
  assert.match(JSON.parse(r.body.manifest).callback_urls[0], /\/api\/auth\/github\/callback$/);

  // A made-up state is refused without calling GitHub.
  let back = await fetch(url("/setup-signin/github/done?code=abc&state=nope"), { redirect: "manual" });
  assert.equal(back.headers.get("location"), "/setup-signin?github=expired");
  assert.equal(conversions.length, 0);

  back = await fetch(url(`/setup-signin/github/done?code=tempcode123&state=${state}`), { redirect: "manual" });
  assert.equal(back.headers.get("location"), "/setup-signin?github=on");
  assert.equal(conversions.length, 1);
  assert.match(conversions[0].href, /\/app-manifests\/tempcode123\/conversions$/);

  // Stored encrypted, never in plain text.
  const rows = db.prepare("SELECT key, value_enc FROM app_settings").all();
  assert.ok(rows.some(x => x.key === "GITHUB_CLIENT_SECRET"));
  assert.ok(rows.every(x => !x.value_enc.includes("for-tests") && !x.value_enc.includes("Iv1.testclient")));

  // GitHub sign-in is now offered and uses the new app.
  assert.ok((await api("/api/config")).body.signIn.includes("github"));
  const go = await fetch(url("/api/auth/github/start"), { redirect: "manual" });
  assert.equal(new URL(go.headers.get("location")).searchParams.get("client_id"), "Iv1.testclient");

  // The same state can't be used twice, and the setup code stops working once sign-in exists.
  back = await fetch(url(`/setup-signin/github/done?code=again&state=${state}`), { redirect: "manual" });
  assert.equal(back.headers.get("location"), "/setup-signin?github=expired");
  assert.equal((await start({ code: "ABCDE-12345" })).status, 403);
  // Nothing secret is ever sent to the browser.
  assert.doesNotMatch(JSON.stringify((await api("/api/setup/status")).body), /secret_for|Iv1\./);
});

test("the owner can run setup without a code, and other people can't", async () => {
  setSetupCodeForTests(null);
  db.prepare("DELETE FROM app_settings").run();
  const someone = signIn("someone@example.com");
  assert.equal((await start({}, someone.cookie)).status, 403);
  const owner = signIn("owner@example.com");
  assert.equal((await start({}, owner.cookie)).status, 200);
});
