import test from "node:test";
import assert from "node:assert/strict";
import { fetchMeme, pickSafeMeme } from "../src/lib/meme.js";

const meme = (extra) => ({
  postLink: "https://redd.it/abc", subreddit: "wholesomememes", title: "A meme",
  url: "https://i.redd.it/abc.jpg", nsfw: false, spoiler: false, ups: 123, ...extra,
});

test("pickSafeMeme skips NSFW, spoilers, missing flags and non-images", () => {
  const picked = pickSafeMeme([
    meme({ nsfw: true, title: "nsfw" }),
    meme({ spoiler: true, title: "spoiler" }),
    meme({ nsfw: undefined, title: "unknown" }),
    meme({ url: "https://v.redd.it/video", title: "video" }),
    meme({ url: "http://i.redd.it/x.png", title: "not https" }),
    meme({ title: "good", url: "https://i.redd.it/good.png" }),
  ]);
  assert.equal(picked.title, "good");
  assert.equal(picked.url, "https://i.redd.it/good.png");
  assert.equal(picked.ups, 123);
});

test("pickSafeMeme returns null when nothing is safe", () => {
  assert.equal(pickSafeMeme([meme({ nsfw: true })]), null);
  assert.equal(pickSafeMeme([]), null);
  assert.equal(pickSafeMeme(undefined), null);
  assert.equal(pickSafeMeme([null]), null);
});

test("fetchMeme handles the multi-meme response format", async () => {
  let requested;
  const fakeFetch = async (url) => {
    requested = url;
    return { ok: true, json: async () => ({ count: 2, memes: [meme({ nsfw: true }), meme({ title: "ok" })] }) };
  };
  const result = await fetchMeme({ subreddits: ["memes"], fetchImpl: fakeFetch });
  assert.equal(result.title, "ok");
  assert.equal(requested, "https://meme-api.com/gimme/memes/10");
});

test("fetchMeme handles the single-meme response format", async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => meme({ title: "single" }) });
  assert.equal((await fetchMeme({ subreddits: ["memes"], fetchImpl: fakeFetch })).title, "single");
});

test("fetchMeme throws on HTTP errors so /meme can show a friendly message", async () => {
  const fakeFetch = async () => ({ ok: false, status: 503 });
  await assert.rejects(fetchMeme({ subreddits: ["memes"], fetchImpl: fakeFetch }), /503/);
});
