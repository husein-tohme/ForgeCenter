import { test } from "node:test";
import assert from "node:assert/strict";
import { api, db, signIn } from "./helpers.js";

const put = (cookie, repo, path, raw, extra = "") => api(`/api/repos/${repo}/file?path=${encodeURIComponent(path)}${extra}`, { method: "PUT", raw, cookie });

test("make a repo, upload files and folders, view, edit and delete them", async () => {
  const { cookie } = signIn("ana");
  const made = await api("/api/repos", { method: "POST", cookie, body: { name: "my-game", description: "A tiny game", readme: true } });
  assert.equal(made.status, 201);
  assert.equal((await api("/api/repos", { method: "POST", cookie, body: { name: "My-Game" } })).status, 409);
  assert.equal((await api("/api/repos", { method: "POST", cookie, body: { name: "bad/name" } })).status, 400);

  assert.equal((await put(cookie, "ana/my-game", "index.html", "<h1>Hi</h1>")).status, 200);
  assert.equal((await put(cookie, "ana/my-game", "src/app.js", "console.log(1)")).status, 200);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
  assert.equal((await put(cookie, "ana/my-game", "art/sword.png", png)).status, 200);

  const repo = await api("/api/repos/ana/my-game");
  assert.deepEqual(repo.body.files.map(f => f.path), ["README.md", "art/sword.png", "index.html", "src/app.js"]);
  assert.equal(repo.body.hasSite, true);
  assert.match(repo.body.readme, /A tiny game/);
  assert.equal(repo.body.commits[0].message, "Add art/sword.png");

  const text = await api("/api/repos/ana/my-game/file?path=src/app.js");
  assert.equal(text.body.text, "console.log(1)");
  assert.equal((await api("/api/repos/ana/my-game/file?path=art/sword.png")).body.text, null);

  await put(cookie, "ana/my-game", "src/app.js", "console.log(2)", "&message=Print%202");
  assert.equal((await api("/api/repos/ana/my-game")).body.commits[0].message, "Print 2");
  assert.equal((await put(cookie, "ana/my-game", "src/app.js", "console.log(2)")).body.unchanged, true);

  // A file and a folder can't share a name.
  assert.equal((await put(cookie, "ana/my-game", "src", "x")).status, 409);
  assert.equal((await put(cookie, "ana/my-game", "index.html/x", "x")).status, 409);

  assert.equal((await api("/api/repos/ana/my-game/file?path=src/app.js", { method: "DELETE", cookie, body: {} })).status, 200);
  assert.equal((await api("/api/repos/ana/my-game/file?path=src/app.js")).status, 404);
});

test("paths can't escape the repo", async () => {
  const { cookie } = signIn("pathy");
  await api("/api/repos", { method: "POST", cookie, body: { name: "r" } });
  for (const bad of ["../x", "/etc/passwd", "a//b", ".", "a/../b", "a\\..\\b", ""]) {
    assert.equal((await put(cookie, "pathy/r", bad, "x")).status, 400, bad);
  }
});

test("only the owner can change a repo, and private repos are hidden", async () => {
  const { cookie } = signIn("owner1");
  const other = signIn("other1");
  await api("/api/repos", { method: "POST", cookie, body: { name: "secret", private: true } });
  await put(cookie, "owner1/secret", "a.txt", "hidden");
  assert.equal((await api("/api/repos/owner1/secret")).status, 404);
  assert.equal((await api("/api/repos/owner1/secret", { cookie: other.cookie })).status, 404);
  assert.equal((await api("/api/repos/owner1/secret", { cookie })).status, 200);
  assert.equal((await api("/raw/owner1/secret/a.txt")).status, 404);
  assert.equal((await api("/zip/owner1/secret")).status, 404);
  assert.equal((await api("/owner1/secret")).status, 404);
  assert.equal((await api("/api/repos/explore?q=secret")).body.repos.length, 0);

  await api("/api/repos", { method: "POST", cookie, body: { name: "open" } });
  assert.equal((await put(other.cookie, "owner1/open", "x.txt", "hi")).status, 404);
  assert.equal((await api("/api/repos/owner1/open", { method: "DELETE", cookie: other.cookie, body: { confirm: "open" } })).status, 404);
  assert.equal((await api("/api/repos/owner1/open", { method: "DELETE", cookie, body: { confirm: "nope" } })).status, 400);
  assert.equal((await api("/api/repos/owner1/open", { method: "DELETE", cookie, body: { confirm: "open" } })).status, 200);
});

test("uploads must come from the site itself", async () => {
  const { cookie } = signIn("csrf");
  await api("/api/repos", { method: "POST", cookie, body: { name: "r" } });
  const evil = await api("/api/repos/csrf/r/file?path=x.txt", { method: "PUT", raw: "x", cookie, origin: "https://evil.example" });
  assert.equal(evil.status, 403);
  const noOrigin = await api("/api/repos/csrf/r/file?path=x.txt", { method: "PUT", raw: "x", cookie, origin: null });
  assert.equal(noOrigin.status, 403);
  // Raw bodies are only allowed on the upload route.
  assert.equal((await api("/api/repos", { method: "POST", raw: "{}", cookie })).status, 415);
});

test("downloads never render, and live sites run sandboxed", async () => {
  const { cookie } = signIn("sites");
  await api("/api/repos", { method: "POST", cookie, body: { name: "web" } });
  await put(cookie, "sites/web", "index.html", "<script>alert(1)</script>");
  await put(cookie, "sites/web", "css/s.css", "body{}");
  const raw = await api("/raw/sites/web/index.html");
  assert.equal(raw.headers.get("content-type"), "application/octet-stream");
  assert.match(raw.headers.get("content-disposition"), /attachment/);

  assert.equal((await api("/p/sites/web")).status, 301);
  const live = await api("/p/sites/web/");
  assert.equal(live.status, 200);
  assert.match(live.headers.get("content-type"), /text\/html/);
  const csp = live.headers.get("content-security-policy");
  assert.match(csp, /^sandbox allow-scripts/);
  assert.doesNotMatch(csp, /allow-same-origin/);
  assert.equal(live.headers.get("cross-origin-resource-policy"), "cross-origin");
  assert.match((await api("/p/sites/web/css/s.css")).headers.get("content-type"), /text\/css/);

  const zip = await api("/zip/sites/web");
  assert.equal(zip.headers.get("content-type"), "application/zip");
  assert.equal(zip.text.slice(0, 2), "PK");
});

test("size limits hold", async () => {
  const { cookie } = signIn("big");
  await api("/api/repos", { method: "POST", cookie, body: { name: "r" } });
  const tooBig = await put(cookie, "big/r", "huge.bin", Buffer.alloc(10 * 1024 * 1024 + 1));
  assert.equal(tooBig.status, 413);
});

test("stars count once per person", async () => {
  const { cookie } = signIn("starrer");
  const owner = signIn("starred");
  await api("/api/repos", { method: "POST", cookie: owner.cookie, body: { name: "cool" } });
  assert.equal((await api("/api/repos/starred/cool/star", { method: "POST", cookie, body: {} })).body.stars, 1);
  assert.equal((await api("/api/repos/starred/cool/star", { method: "POST", cookie, body: {} })).body.stars, 0);
});

test("profiles and repo pages have their own titles; reserved names are pages", async () => {
  const { cookie } = signIn("pagey");
  await api("/api/repos", { method: "POST", cookie, body: { name: "thing", description: "Does things" } });
  const profile = await api("/pagey");
  assert.match(profile.text, /<title>pagey \(@pagey\) · Forgehub<\/title>/);
  const repo = await api("/pagey/thing");
  assert.match(repo.text, /<title>pagey\/thing · Forgehub<\/title>/);
  assert.match(repo.text, /content="Does things"/);
  assert.match((await api("/explore")).text, /<title>Explore repos/);
  assert.equal((await api("/nobody-here")).status, 404);
  assert.match((await api("/sitemap.xml")).text, /\/pagey\/thing/);
});

test("deleting an account removes its repos and files", async () => {
  const { user, cookie } = signIn("leaver");
  await api("/api/repos", { method: "POST", cookie, body: { name: "r" } });
  await put(cookie, "leaver/r", "a.txt", "x");
  assert.equal((await api("/api/me", { method: "DELETE", cookie, body: {} })).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM repos WHERE user_id = ?").get(user.id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM repo_files f WHERE NOT EXISTS (SELECT 1 FROM repos r WHERE r.id = f.repo_id)").get().n, 0);
});
