import { test } from "node:test";
import assert from "node:assert/strict";
import { url } from "./helpers.js";

const get = async path => {
  const r = await fetch(url(path));
  return { status: r.status, type: r.headers.get("content-type") ?? "", text: await r.text() };
};

test("pages carry full link-preview addresses", async () => {
  const home = await get("/");
  assert.equal(home.status, 200);
  const base = url("");
  assert.ok(home.text.includes(`<meta property="og:image" content="${base}/og.png">`));
  assert.ok(home.text.includes(`<link rel="canonical" href="${base}/">`));
  assert.ok(!home.text.includes("%BASE_URL%") && !home.text.includes("%PAGE_URL%"));

  for (const path of ["/textures", "/textures.html"]) {
    const page = await get(path);
    assert.equal(page.status, 200);
    assert.ok(page.text.includes(`<link rel="canonical" href="${base}/textures">`), path);
  }
});

test("unknown pages get the not-found page", async () => {
  const r = await get("/no-such-page");
  assert.equal(r.status, 404);
  assert.match(r.type, /text\/html/);
  assert.match(r.text, /Page not found/);
  assert.equal((await fetch(url("/api/no-such-thing"))).status, 404);
});

test("nothing outside public/ can be fetched", async () => {
  for (const path of ["/%2e%2e/src/app.js", "/..%2fsrc%2fapp.js", "/%2e%2e/.env.example", "/src/app.js"]) {
    const r = await get(path);
    assert.notEqual(r.status, 200, path);
    assert.ok(!r.text.includes("createApp") && !r.text.includes("STRIPE_SECRET_KEY"), path);
  }
});

test("robots.txt and the sitemap list only public pages", async () => {
  const robots = await get("/robots.txt");
  assert.match(robots.text, /Disallow: \/admin/);
  assert.match(robots.text, /Disallow: \/account/);
  assert.ok(robots.text.includes(`Sitemap: ${url("")}/sitemap.xml`));
  const sitemap = await get("/sitemap.xml");
  assert.ok(sitemap.text.includes(`<loc>${url("")}/plugins</loc>`));
  assert.ok(!sitemap.text.includes("/account") && !sitemap.text.includes("/admin"));
});

test("the icon and preview image are served", async () => {
  assert.match((await get("/favicon.svg")).type, /image\/svg\+xml/);
  const og = await fetch(url("/og.png"));
  assert.equal(og.headers.get("content-type"), "image/png");
});

test("the CodeHub owner page is served but kept out of search engines", async () => {
  const page = await get("/learn-admin");
  assert.equal(page.status, 200);
  assert.match(page.text, /<meta name="robots" content="noindex">/);
  assert.match((await get("/robots.txt")).text, /Disallow: \/learn-admin/);
  assert.ok(!(await get("/sitemap.xml")).text.includes("/learn-admin"));
});

test("CodeHub pages are served, and only lesson pages let in YouTube's player", async () => {
  const home = await fetch(url("/learn"));
  assert.equal(home.status, 200);
  assert.ok(!home.headers.get("content-security-policy").includes("youtube"));
  assert.ok((await get("/sitemap.xml")).text.includes(`<loc>${url("")}/learn</loc>`));

  const lesson = await fetch(url("/learn/lesson?id=1"));
  assert.equal(lesson.status, 200);
  const csp = lesson.headers.get("content-security-policy");
  assert.match(csp, /script-src 'self' https:\/\/www\.youtube\.com/);
  assert.match(csp, /frame-src https:\/\/www\.youtube-nocookie\.com https:\/\/www\.youtube\.com https:\/\/accounts\.google\.com/);
  assert.match(await lesson.text(), /id="lesson"/);

  // The file behind the lesson page isn't served at its own address, without that policy.
  assert.equal((await get("/learn-lesson")).status, 404);
  assert.ok(!(await fetch(url("/games"))).headers.get("content-security-policy").includes("youtube"));
});
