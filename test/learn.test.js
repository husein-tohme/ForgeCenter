import { test } from "node:test";
import assert from "node:assert/strict";
import { api, signIn } from "./helpers.js";
import { parseYouTube } from "../src/learn.js";

const owner = () => signIn("owner@example.com", "owner-sub", { age: "adult" });
const code = Array.from({ length: 12 }, (_, i) => `print(${i + 1})`).join("\n");

// A published track with one published lesson holding a file and a clip.
async function lessonWithClip(cookie, slug) {
  const t = await api("/api/admin/learn/tracks", { method: "POST", cookie, body: { title: `Python ${slug}`, slug, level: "beginner", language: "python", status: "published" } });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  const l = await api(`/api/admin/learn/tracks/${t.body.track.id}/lessons`, { method: "POST", cookie, body: { title: "Your first program", body: "Type this.", status: "published" } });
  assert.equal(l.status, 201, JSON.stringify(l.body));
  const f = await api(`/api/admin/learn/lessons/${l.body.lesson.id}/files`, { method: "POST", cookie, body: { path: "main.py", language: "python", content: code } });
  assert.equal(f.status, 201, JSON.stringify(f.body));
  const c = await api(`/api/admin/learn/lessons/${l.body.lesson.id}/clips`, { method: "POST", cookie, body: {
    video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", title: "Print in Python", channelName: "Coder", channelUrl: "https://youtube.com/@coder", start: 30, end: 300 } });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  return { track: t.body.track, lessonId: l.body.lesson.id, fileId: f.body.files[0].id, clipId: c.body.clips[0].id };
}

test("YouTube links and IDs are read, and anything else is refused", () => {
  assert.deepEqual(parseYouTube("dQw4w9WgXcQ"), { id: "dQw4w9WgXcQ", short: false });
  assert.deepEqual(parseYouTube("https://youtu.be/dQw4w9WgXcQ?t=5"), { id: "dQw4w9WgXcQ", short: false });
  assert.deepEqual(parseYouTube("https://m.youtube.com/watch?v=dQw4w9WgXcQ"), { id: "dQw4w9WgXcQ", short: false });
  assert.deepEqual(parseYouTube("https://www.youtube.com/shorts/dQw4w9WgXcQ"), { id: "dQw4w9WgXcQ", short: true });
  assert.deepEqual(parseYouTube("https://www.youtube.com/embed/dQw4w9WgXcQ"), { id: "dQw4w9WgXcQ", short: false });
  for (const bad of ["", "dQw4w9WgXc", "https://evil.example/watch?v=dQw4w9WgXcQ", "javascript:alert(1)", "https://youtube.com/watch?v=bad id!!!", null, 42]) {
    assert.equal(parseYouTube(bad), null, String(bad));
  }
});

test("only the owner can manage tracks and lessons", async () => {
  const me = signIn("learner@example.com");
  assert.equal((await api("/api/admin/learn/tracks")).status, 401);
  assert.equal((await api("/api/admin/learn/tracks", { cookie: me.cookie })).status, 403);
  assert.equal((await api("/api/admin/learn/tracks", { method: "POST", cookie: me.cookie, body: { title: "Mine" } })).status, 403);
});

test("drafts stay hidden until both the lesson and its track are published", async () => {
  const { cookie } = owner();
  const t = await api("/api/admin/learn/tracks", { method: "POST", cookie, body: { title: "Web basics", level: "beginner" } });
  assert.equal(t.status, 201);
  assert.equal(t.body.track.slug, "web-basics");
  assert.equal(t.body.track.status, "draft");
  const l = await api(`/api/admin/learn/tracks/${t.body.track.id}/lessons`, { method: "POST", cookie, body: { title: "Tags", status: "published" } });
  const lessonId = l.body.lesson.id;

  assert.ok(!(await api("/api/learn/tracks")).body.tracks.some(x => x.id === t.body.track.id));
  assert.equal((await api("/api/learn/tracks/web-basics")).status, 404);
  assert.equal((await api(`/api/learn/lessons/${lessonId}`)).status, 404);
  assert.equal((await api(`/api/learn/lessons/${lessonId}`, { cookie })).status, 200); // the owner can preview

  await api(`/api/admin/learn/tracks/${t.body.track.id}`, { method: "PATCH", cookie, body: { status: "published" } });
  const listed = (await api("/api/learn/tracks")).body.tracks.find(x => x.id === t.body.track.id);
  assert.equal(listed.lessons, 1);
  assert.equal((await api(`/api/learn/lessons/${lessonId}`)).status, 200);

  await api(`/api/admin/learn/lessons/${lessonId}`, { method: "PATCH", cookie, body: { status: "draft" } });
  assert.equal((await api(`/api/learn/lessons/${lessonId}`)).status, 404);
  assert.equal((await api("/api/learn/tracks/web-basics")).body.lessons.length, 0);
});

test("bad input gets a clear message, and names can't be used twice", async () => {
  const { cookie } = owner();
  const post = body => api("/api/admin/learn/tracks", { method: "POST", cookie, body });
  assert.equal((await post({})).status, 400);
  assert.match((await post({ title: "x", level: "wizard" })).body.error, /Level must be one of/);
  assert.match((await post({ title: "x", slug: "Not A Slug" })).body.error, /lowercase letters/);
  assert.match((await post({ title: { $ne: 1 } })).body.error, /must be text/);
  assert.match((await post({ title: "x".repeat(121) })).body.error, /under 120/);
  assert.equal((await post({ title: "Same name" })).status, 201);
  assert.equal((await post({ title: "Same name" })).status, 409);

  const t = (await post({ title: "Files test" })).body.track;
  const l = (await api(`/api/admin/learn/tracks/${t.id}/lessons`, { method: "POST", cookie, body: { title: "One" } })).body.lesson;
  const file = body => api(`/api/admin/learn/lessons/${l.id}/files`, { method: "POST", cookie, body });
  for (const path of ["../secret", "/etc/passwd", "a//b", "src/./x", "a\\b"]) {
    assert.equal((await file({ path, content: "x" })).status, 400, path);
  }
  assert.equal((await file({ path: "main.py" })).status, 400);
  assert.equal((await file({ path: "main.py", content: "x".repeat(90_001) })).status, 400);
  assert.equal((await api("/api/admin/learn/lessons/abc/files", { method: "POST", cookie, body: { path: "a.py", content: "" } })).status, 404);

  const clip = body => api(`/api/admin/learn/lessons/${l.id}/clips`, { method: "POST", cookie, body: { title: "A video", ...body } });
  assert.match((await clip({ video: "https://vimeo.com/123" })).body.error, /YouTube/);
  assert.match((await clip({ video: "dQw4w9WgXcQ", start: 60, end: 30 })).body.error, /end after it starts/);
  assert.match((await clip({ video: "dQw4w9WgXcQ", start: -1 })).body.error, /whole number of seconds/);
  assert.match((await clip({ video: "dQw4w9WgXcQ", channelUrl: "javascript:alert(1)" })).body.error, /http/);
  const short = await clip({ video: "https://youtube.com/shorts/dQw4w9WgXcQ" });
  assert.equal(short.body.clips[0].form, "short");
});

test("a lesson page gets its files, clips and code links in one answer", async () => {
  const { cookie } = owner();
  const { lessonId, fileId, clipId } = await lessonWithClip(cookie, "one-answer");
  const link = body => api(`/api/admin/learn/clips/${clipId}/links`, { method: "POST", cookie, body: { fileId, start: 40, end: 60, lines: [1, 3], ...body } });

  assert.match((await link({ lines: [5, 99] })).body.error, /only has 12 lines/);
  assert.match((await link({ lines: [3, 1] })).body.error, /first and last line/);
  assert.match((await link({ start: 10 })).body.error, /inside the clip/);
  assert.match((await link({ end: 301 })).body.error, /inside the clip/);
  assert.match((await link({ fileId: 999999 })).body.error, /code file from this lesson/);
  assert.equal((await link({ note: "print shows text" })).status, 201);
  assert.equal((await link({ start: 70, end: 90, lines: [4, 6] })).status, 201);

  const page = await api(`/api/learn/lessons/${lessonId}`);
  assert.equal(page.status, 200);
  assert.equal(page.body.files[0].path, "main.py");
  assert.equal(page.body.files[0].lines, 12);
  const [clip] = page.body.clips;
  assert.equal(clip.youtubeId, "dQw4w9WgXcQ");
  assert.equal(clip.start, 30);
  assert.deepEqual(clip.links.map(k => [k.start, k.end, k.lines]), [[40, 60, [1, 3]], [70, 90, [4, 6]]]);
  assert.equal(clip.links[0].note, "print shows text");
  assert.equal(page.body.next, null);

  // Code can't shrink below a linked line, and a clip can't be cut around its links.
  assert.match((await api(`/api/admin/learn/files/${fileId}`, { method: "PATCH", cookie, body: { content: "print(1)" } })).body.error, /past the end/);
  assert.match((await api(`/api/admin/learn/clips/${clipId}`, { method: "PATCH", cookie, body: { start: 50 } })).body.error, /outside the new start/);
  const edited = await api(`/api/admin/learn/files/${fileId}`, { method: "PATCH", cookie, body: { content: `${code}\r\nprint(13)` } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.files[0].lines, 13);
  assert.ok(!edited.body.files[0].content.includes("\r"));

  // A hidden clip disappears from the public page but stays for the owner.
  await api(`/api/admin/learn/clips/${clipId}`, { method: "PATCH", cookie, body: { status: "hidden" } });
  assert.equal((await api(`/api/learn/lessons/${lessonId}`)).body.clips.length, 0);
  assert.equal((await api(`/api/learn/lessons/${lessonId}`, { cookie })).body.clips.length, 1);
});

test("lessons know the one before and after, and deleting a track removes everything in it", async () => {
  const { cookie } = owner();
  const { track, lessonId, clipId } = await lessonWithClip(cookie, "order");
  const second = await api(`/api/admin/learn/tracks/${track.id}/lessons`, { method: "POST", cookie, body: { title: "Variables", status: "published" } });
  const first = (await api(`/api/learn/lessons/${lessonId}`)).body;
  assert.deepEqual(first.next, { id: second.body.lesson.id, title: "Variables" });
  assert.deepEqual((await api(`/api/learn/lessons/${second.body.lesson.id}`)).body.previous, { id: lessonId, title: "Your first program" });

  assert.equal((await api(`/api/admin/learn/tracks/${track.id}`, { method: "DELETE", cookie, body: {} })).status, 200);
  assert.equal((await api(`/api/learn/lessons/${lessonId}`, { cookie })).status, 404);
  assert.equal((await api(`/api/admin/learn/clips/${clipId}`, { method: "PATCH", cookie, body: { title: "x" } })).status, 404);
});

test("people can report a clip and the owner can hide it", async () => {
  const { cookie } = owner();
  const { lessonId, clipId } = await lessonWithClip(cookie, "reports");
  const me = signIn("clip-reporter@example.com");
  const r = await api("/api/reports", { method: "POST", cookie: me.cookie, body: { type: "clip", id: String(clipId), reason: "inappropriate" } });
  assert.equal(r.status, 201, JSON.stringify(r.body));

  const queue = (await api("/api/admin/reports", { cookie })).body.reports;
  const mine = queue.find(x => x.type === "clip" && x.targetId === String(clipId)) ?? queue.find(x => x.target?.url === `/learn/lesson?id=${lessonId}`);
  assert.ok(mine, JSON.stringify(queue.slice(0, 2)));
  assert.equal(mine.canHide, true);
});
