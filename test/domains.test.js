import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { api, base, signIn } from "./helpers.js";
import { setTxtLookup } from "../src/domains.js";

// fetch won't let tests set the Host header, so use plain http.
const get = (host, path) => new Promise((resolve, reject) => {
  const u = new URL(base);
  request({ host: u.hostname, port: u.port, path, headers: { Host: host } }, res => {
    let body = ""; res.on("data", c => body += c); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
  }).on("error", reject).end();
});
const put = (cookie, repo, path, raw) => api(`/api/repos/${repo}/file?path=${encodeURIComponent(path)}`, { method: "PUT", raw, cookie });

test("subdomains serve a user's public repos as normal sites", async () => {
  process.env.SITES_DOMAIN = "sites.test";
  const { cookie } = signIn("maya");
  await api("/api/repos", { method: "POST", cookie, body: { name: "game" } });
  await put(cookie, "maya/game", "index.html", "<h1>Game</h1>");
  await put(cookie, "maya/game", "about.html", "<h1>About</h1>");
  await api("/api/repos", { method: "POST", cookie, body: { name: "maya.sites.test" } });
  await put(cookie, "maya/maya.sites.test", "index.html", "<h1>Home</h1>");
  await api("/api/repos", { method: "POST", cookie, body: { name: "hidden", private: true } });
  await put(cookie, "maya/hidden", "index.html", "secret");

  const page = await get("maya.sites.test", "/game/");
  assert.equal(page.status, 200);
  assert.match(page.body, /Game/);
  assert.equal(page.headers["content-security-policy"], undefined); // its own origin: no sandbox needed
  assert.equal((await get("maya.sites.test", "/game")).status, 301);
  assert.match((await get("maya.sites.test", "/game/about")).body, /About/);
  assert.match((await get("maya.sites.test", "/")).body, /Home/);
  assert.equal((await get("maya.sites.test", "/hidden/")).status, 404);
  assert.equal((await get("maya.sites.test", "/api/me")).status, 404); // never Forgehub's API
  const post = await new Promise(r => { const u = new URL(base); request({ host: u.hostname, port: u.port, path: "/game/", method: "POST", headers: { Host: "maya.sites.test" } }, x => r(x.statusCode)).end(); });
  assert.equal(post, 405);
  assert.equal((await api("/api/domains/allowed?domain=maya.sites.test")).status, 200);
  delete process.env.SITES_DOMAIN;
});

test("custom domains are served only after the owner proves they control them", async () => {
  const { cookie } = signIn("dev1");
  const other = signIn("dev2");
  await api("/api/repos", { method: "POST", cookie, body: { name: "site" } });
  await put(cookie, "dev1/site", "index.html", "<h1>Mine</h1>");
  assert.equal((await api("/api/domains/dev1/site", { method: "PUT", cookie, body: { domain: "not a domain" } })).status, 400);
  const added = await api("/api/domains/dev1/site", { method: "PUT", cookie, body: { domain: "https://www.MyGame.com/" } });
  assert.equal(added.body.domain.domain, "mygame.com");
  assert.equal(added.body.domain.verified, false);
  assert.equal((await api("/api/domains/dev1/site", { method: "PUT", cookie: other.cookie, body: { domain: "x.com" } })).status, 404);

  assert.equal((await get("mygame.com", "/")).status, 404); // not verified yet: not served
  assert.equal((await api("/api/domains/allowed?domain=mygame.com")).status, 404);

  setTxtLookup(async () => [["wrong"]]);
  assert.equal((await api("/api/domains/dev1/site/verify", { method: "POST", cookie, body: {} })).status, 409);
  setTxtLookup(async name => name === "_forgehub.mygame.com" ? [[added.body.domain.txtValue]] : []);
  assert.equal((await api("/api/domains/dev1/site/verify", { method: "POST", cookie, body: {} })).body.domain.verified, true);
  setTxtLookup(null);

  assert.match((await get("mygame.com", "/")).body, /Mine/);
  assert.match((await get("www.mygame.com", "/")).body, /Mine/);
  assert.equal((await api("/api/domains/allowed?domain=mygame.com")).status, 200);

  // Another repo can't take it.
  await api("/api/repos", { method: "POST", cookie: other.cookie, body: { name: "copy" } });
  assert.equal((await api("/api/domains/dev2/copy", { method: "PUT", cookie: other.cookie, body: { domain: "mygame.com" } })).status, 409);

  // Making the repo private takes the site offline.
  await api("/api/repos/dev1/site", { method: "PATCH", cookie, body: { private: true } });
  assert.equal((await get("mygame.com", "/")).status, 404);
});
