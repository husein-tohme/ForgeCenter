// CodeHub, ForgeCenter's learning section (/learn; plan in docs/academy). Tracks hold
// lessons; a lesson has code files and YouTube clips, and links tie a moment of a clip
// to lines of a file. At launch those links are made by people in the owner panel.
// Clips are only ever embedded from YouTube, never downloaded.
import express from "express";
import { db, now } from "./db.js";
import { isAdmin, requireAdmin, requireUser } from "./auth.js";
import { registerReportTarget } from "./reports.js";

db.exec(`
CREATE TABLE IF NOT EXISTS learn_tracks (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT '',
  expect_text TEXT NOT NULL DEFAULT '',
  study_text TEXT NOT NULL DEFAULT '',
  make_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS learn_lessons (
  id INTEGER PRIMARY KEY,
  track_id INTEGER NOT NULL REFERENCES learn_tracks(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (track_id, slug)
);
CREATE TABLE IF NOT EXISTS learn_files (
  id INTEGER PRIMARY KEY,
  lesson_id INTEGER NOT NULL REFERENCES learn_lessons(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  line_count INTEGER NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE (lesson_id, path)
);
-- form: short (YouTube Shorts and videos under 5 minutes, for the quick clips feed) or long.
CREATE TABLE IF NOT EXISTS learn_clips (
  id INTEGER PRIMARY KEY,
  lesson_id INTEGER NOT NULL REFERENCES learn_lessons(id) ON DELETE CASCADE,
  youtube_id TEXT NOT NULL,
  title TEXT NOT NULL,
  channel_name TEXT NOT NULL DEFAULT '',
  channel_url TEXT,
  start_s INTEGER NOT NULL DEFAULT 0,
  end_s INTEGER,
  form TEXT NOT NULL DEFAULT 'long',
  status TEXT NOT NULL DEFAULT 'live',
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
-- "From start_s to end_s, the clip explains these lines of this file."
CREATE TABLE IF NOT EXISTS learn_links (
  id INTEGER PRIMARY KEY,
  clip_id INTEGER NOT NULL REFERENCES learn_clips(id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL REFERENCES learn_files(id) ON DELETE CASCADE,
  start_s INTEGER NOT NULL,
  end_s INTEGER NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS learn_links_clip ON learn_links(clip_id, start_s);
-- Ratings and "helped" / "skip" marks; their routes come with ranking.
CREATE TABLE IF NOT EXISTS learn_ratings (
  clip_id INTEGER NOT NULL REFERENCES learn_clips(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  PRIMARY KEY (clip_id, user_id)
);
CREATE TABLE IF NOT EXISTS learn_marks (
  id INTEGER PRIMARY KEY,
  clip_id INTEGER NOT NULL REFERENCES learn_clips(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_s INTEGER NOT NULL,
  end_s INTEGER NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS learn_marks_clip ON learn_marks(clip_id);
`);

export const LEVELS = ["beginner", "hobby", "pro", "expert"];
const STATUSES = ["draft", "published"];
const MAX_SECONDS = 24 * 60 * 60;
// Requests are capped at 100 KB (app.js), so one file stays under that with room to spare.
const MAX_CODE = 90_000;
const MAX_BODY = 50_000;

class InputError extends Error {}
const fail = message => { throw new InputError(message); };
// Wraps a route so bad input answers 400 (or 409 for a taken name) with its message.
const handle = fn => (req, res) => {
  try { fn(req, res); } catch (e) {
    if (e instanceof InputError) return res.status(400).json({ error: e.message });
    if (/UNIQUE constraint failed/.test(e.message)) return res.status(409).json({ error: "That name is already used here. Pick another one." });
    throw e;
  }
};

const text = (value, max, label, { required = false } = {}) => {
  if (value === undefined || value === null) return required ? fail(`Add ${label}.`) : "";
  if (typeof value !== "string") fail(`${label[0].toUpperCase()}${label.slice(1)} must be text.`);
  const t = value.trim();
  if (required && !t) fail(`Add ${label}.`);
  if (t.length > max) fail(`Keep ${label} under ${max.toLocaleString("en-US")} characters.`);
  return t;
};
const slugify = s => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const slugOf = (value, title) => {
  const s = value === undefined ? slugify(title ?? "") : typeof value === "string" ? value.trim() : "";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) || s.length > 60) fail("Use lowercase letters, numbers and dashes for the web address (for example python-basics).");
  return s;
};
const oneOf = (value, allowed, label) => allowed.includes(value) ? value : fail(`${label} must be one of: ${allowed.join(", ")}.`);
const seconds = (value, label) => Number.isInteger(value) && value >= 0 && value <= MAX_SECONDS ? value : fail(`${label} must be a whole number of seconds.`);
const position = value => Number.isInteger(value) && value >= 0 && value <= 100_000 ? value : fail("Position must be a whole number.");
const idParam = v => /^[1-9][0-9]{0,15}$/.test(v) ? Number(v) : 0;
const nextPosition = (table, column, value) =>
  db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM ${table} WHERE ${column} = ?`).get(value).p;

// Accepts a YouTube video ID or any normal YouTube link, including Shorts.
export function parseYouTube(input) {
  const raw = typeof input === "string" ? input.trim() : "";
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return { id: raw, short: false };
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!["http:", "https:"].includes(u.protocol)) return null;
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  let id = null, short = false;
  if (host === "youtu.be") id = u.pathname.slice(1);
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [, first, second] = u.pathname.split("/");
    if (first === "watch") id = u.searchParams.get("v");
    else if (["shorts", "embed", "live"].includes(first)) { id = second; short = first === "shorts"; }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? { id, short } : null;
}

// Links people see must be plain web addresses.
const webLink = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  const t = text(value, 300, label);
  return /^https?:\/\/[^\s]+$/i.test(t) ? t : fail(`${label[0].toUpperCase()}${label.slice(1)} must start with http:// or https://.`);
};
const filePath = value => {
  const p = text(value, 200, "a file name", { required: true });
  if (!/^[A-Za-z0-9._ -]+(\/[A-Za-z0-9._ -]+)*$/.test(p) || p.split("/").some(part => part === "." || part === "..")) {
    fail("Use a simple file name like main.py or src/index.js.");
  }
  return p;
};
const lineCount = content => content === "" ? 0 : content.split("\n").length;

// ---------- Reading ----------
const trackOut = t => ({
  id: t.id, slug: t.slug, title: t.title, summary: t.summary, level: t.level, language: t.language,
  expect: t.expect_text, study: t.study_text, make: t.make_text, status: t.status, position: t.position,
});
const lessonOut = l => ({ id: l.id, trackId: l.track_id, slug: l.slug, title: l.title, summary: l.summary, status: l.status, position: l.position });
const clipOut = c => ({
  id: c.id, youtubeId: c.youtube_id, title: c.title, channelName: c.channel_name, channelUrl: c.channel_url,
  start: c.start_s, end: c.end_s, form: c.form, status: c.status, position: c.position,
});
const linkOut = k => ({ id: k.id, clipId: k.clip_id, fileId: k.file_id, start: k.start_s, end: k.end_s, lines: [k.line_start, k.line_end], note: k.note });

// Everything a lesson page needs in one answer, so the page never asks again while the
// video plays (docs/academy/04-block2-learning-screen.md).
function fullLesson(lesson, { owner = false } = {}) {
  const track = db.prepare("SELECT * FROM learn_tracks WHERE id = ?").get(lesson.track_id);
  const files = db.prepare("SELECT id, path, language, content, line_count FROM learn_files WHERE lesson_id = ? ORDER BY position, id").all(lesson.id)
    .map(f => ({ id: f.id, path: f.path, language: f.language, content: f.content, lines: f.line_count }));
  const clips = db.prepare(`SELECT * FROM learn_clips WHERE lesson_id = ? ${owner ? "" : "AND status = 'live'"} ORDER BY position, id`).all(lesson.id);
  const links = clips.length ? db.prepare(`SELECT * FROM learn_links WHERE clip_id IN (${clips.map(() => "?").join(",")}) ORDER BY start_s, id`)
    .all(...clips.map(c => c.id)) : [];
  const siblings = db.prepare(`SELECT id, slug, title, position FROM learn_lessons WHERE track_id = ? ${owner ? "" : "AND status = 'published'"}
    ORDER BY position, id`).all(lesson.track_id);
  const at = siblings.findIndex(s => s.id === lesson.id);
  return {
    lesson: { ...lessonOut(lesson), body: lesson.body },
    track: { id: track.id, slug: track.slug, title: track.title, level: track.level, language: track.language },
    files,
    clips: clips.map(c => ({ ...clipOut(c), links: links.filter(k => k.clip_id === c.id).map(linkOut) })),
    previous: at > 0 ? { id: siblings[at - 1].id, title: siblings[at - 1].title } : null,
    next: at >= 0 && at < siblings.length - 1 ? { id: siblings[at + 1].id, title: siblings[at + 1].title } : null,
  };
}

export const learnRouter = express.Router();

learnRouter.get("/tracks", (_req, res) => {
  const rows = db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM learn_lessons l WHERE l.track_id = t.id AND l.status = 'published') AS lessons
    FROM learn_tracks t WHERE t.status = 'published' ORDER BY t.position, t.id`).all();
  res.json({ tracks: rows.map(t => ({ ...trackOut(t), lessons: t.lessons })) });
});

learnRouter.get("/tracks/:slug", (req, res) => {
  const owner = isAdmin(req.user);
  const t = db.prepare("SELECT * FROM learn_tracks WHERE slug = ?").get(String(req.params.slug));
  if (!t || (t.status !== "published" && !owner)) return res.status(404).json({ error: "Track not found." });
  const lessons = db.prepare(`SELECT * FROM learn_lessons WHERE track_id = ? ${owner ? "" : "AND status = 'published'"} ORDER BY position, id`).all(t.id);
  res.json({ track: trackOut(t), lessons: lessons.map(lessonOut) });
});

// A lesson is public once both it and its track are published; the owner sees drafts.
learnRouter.get("/lessons/:id", (req, res) => {
  const owner = isAdmin(req.user);
  const l = db.prepare(`SELECT l.*, t.status AS track_status FROM learn_lessons l JOIN learn_tracks t ON t.id = l.track_id WHERE l.id = ?`)
    .get(idParam(req.params.id));
  if (!l || ((l.status !== "published" || l.track_status !== "published") && !owner)) return res.status(404).json({ error: "Lesson not found." });
  res.json(fullLesson(l, { owner }));
});

// ---------- Owner routes ----------
export const adminLearnRouter = express.Router();
adminLearnRouter.use("/learn", requireUser, requireAdmin);

const getRow = (table, id) => db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(idParam(id));
const notFound = (res, what) => res.status(404).json({ error: `${what} not found.` });
// Applies only the fields that were sent; each field's check returns the stored value.
function update(table, id, body, fields) {
  const sets = [], values = [];
  for (const [key, [column, check]] of Object.entries(fields)) {
    if (body[key] === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(check(body[key]));
  }
  if (!sets.length) fail("Nothing to change.");
  if (["learn_tracks", "learn_lessons"].includes(table)) { sets.push("updated_at = ?"); values.push(now()); }
  db.prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
}

const TRACK_FIELDS = {
  slug: ["slug", v => slugOf(v)],
  title: ["title", v => text(v, 120, "a title", { required: true })],
  summary: ["summary", v => text(v, 300, "the summary")],
  level: ["level", v => oneOf(v, LEVELS, "Level")],
  language: ["language", v => text(v, 40, "the language")],
  expect: ["expect_text", v => text(v, 3000, "what to expect")],
  study: ["study_text", v => text(v, 3000, "how to study it")],
  make: ["make_text", v => text(v, 3000, "what you'll make")],
  status: ["status", v => oneOf(v, STATUSES, "Status")],
  position: ["position", position],
};
const LESSON_FIELDS = {
  slug: ["slug", v => slugOf(v)],
  title: ["title", v => text(v, 120, "a title", { required: true })],
  summary: ["summary", v => text(v, 300, "the summary")],
  body: ["body", v => text(v, MAX_BODY, "the lesson text")],
  status: ["status", v => oneOf(v, STATUSES, "Status")],
  position: ["position", position],
};

adminLearnRouter.get("/learn/tracks", (_req, res) => {
  const rows = db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM learn_lessons l WHERE l.track_id = t.id) AS lessons
    FROM learn_tracks t ORDER BY t.position, t.id`).all();
  res.json({ tracks: rows.map(t => ({ ...trackOut(t), lessons: t.lessons })) });
});

adminLearnRouter.post("/learn/tracks", handle((req, res) => {
  const b = req.body ?? {};
  const title = text(b.title, 120, "a title", { required: true });
  const id = Number(db.prepare(`INSERT INTO learn_tracks (slug, title, summary, level, language, expect_text, study_text, make_text, status, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    slugOf(b.slug, title), title, text(b.summary, 300, "the summary"), oneOf(b.level ?? "beginner", LEVELS, "Level"),
    text(b.language, 40, "the language"), text(b.expect, 3000, "what to expect"), text(b.study, 3000, "how to study it"),
    text(b.make, 3000, "what you'll make"), oneOf(b.status ?? "draft", STATUSES, "Status"),
    b.position === undefined ? nextPosition("learn_tracks", "1", 1) : position(b.position), now(), now()).lastInsertRowid);
  res.status(201).json({ track: trackOut(getRow("learn_tracks", id)) });
}));

adminLearnRouter.patch("/learn/tracks/:id", handle((req, res) => {
  const t = getRow("learn_tracks", req.params.id);
  if (!t) return notFound(res, "Track");
  update("learn_tracks", t.id, req.body ?? {}, TRACK_FIELDS);
  res.json({ track: trackOut(getRow("learn_tracks", t.id)) });
}));

// Deleting a track deletes its lessons, files, clips and links with it.
adminLearnRouter.delete("/learn/tracks/:id", (req, res) => {
  const r = db.prepare("DELETE FROM learn_tracks WHERE id = ?").run(idParam(req.params.id));
  r.changes ? res.json({ ok: true }) : notFound(res, "Track");
});

adminLearnRouter.post("/learn/tracks/:id/lessons", handle((req, res) => {
  const t = getRow("learn_tracks", req.params.id);
  if (!t) return notFound(res, "Track");
  const b = req.body ?? {};
  const title = text(b.title, 120, "a title", { required: true });
  const id = Number(db.prepare(`INSERT INTO learn_lessons (track_id, slug, title, summary, body, status, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    t.id, slugOf(b.slug, title), title, text(b.summary, 300, "the summary"), text(b.body, MAX_BODY, "the lesson text"),
    oneOf(b.status ?? "draft", STATUSES, "Status"),
    b.position === undefined ? nextPosition("learn_lessons", "track_id", t.id) : position(b.position), now(), now()).lastInsertRowid);
  res.status(201).json(fullLesson(getRow("learn_lessons", id), { owner: true }));
}));

adminLearnRouter.patch("/learn/lessons/:id", handle((req, res) => {
  const l = getRow("learn_lessons", req.params.id);
  if (!l) return notFound(res, "Lesson");
  update("learn_lessons", l.id, req.body ?? {}, LESSON_FIELDS);
  res.json(fullLesson(getRow("learn_lessons", l.id), { owner: true }));
}));

adminLearnRouter.delete("/learn/lessons/:id", (req, res) => {
  const r = db.prepare("DELETE FROM learn_lessons WHERE id = ?").run(idParam(req.params.id));
  r.changes ? res.json({ ok: true }) : notFound(res, "Lesson");
});

// ---------- Code files ----------
const codeOf = value => {
  if (typeof value !== "string") fail("Add the file's code.");
  if (value.length > MAX_CODE) fail(`Keep a file under ${MAX_CODE.toLocaleString("en-US")} characters. Split bigger code into several files.`);
  return value.replace(/\r\n?/g, "\n");
};
// A file can't shrink below a line that a clip link points at.
const checkLinksFit = (fileId, lines) => {
  const tooFar = db.prepare("SELECT 1 FROM learn_links WHERE file_id = ? AND line_end > ?").get(fileId, lines);
  if (tooFar) fail("Some clip links point at lines past the end of the new code. Change or delete those links first.");
};

adminLearnRouter.post("/learn/lessons/:id/files", handle((req, res) => {
  const l = getRow("learn_lessons", req.params.id);
  if (!l) return notFound(res, "Lesson");
  const b = req.body ?? {};
  const content = codeOf(b.content);
  db.prepare("INSERT INTO learn_files (lesson_id, path, language, content, line_count, position) VALUES (?, ?, ?, ?, ?, ?)").run(
    l.id, filePath(b.path), text(b.language, 40, "the language"), content, lineCount(content),
    b.position === undefined ? nextPosition("learn_files", "lesson_id", l.id) : position(b.position));
  res.status(201).json(fullLesson(l, { owner: true }));
}));

adminLearnRouter.patch("/learn/files/:id", handle((req, res) => {
  const f = getRow("learn_files", req.params.id);
  if (!f) return notFound(res, "File");
  const b = { ...req.body };
  if (b.content !== undefined) {
    b.content = codeOf(b.content);
    b.lineCount = lineCount(b.content);
    checkLinksFit(f.id, b.lineCount);
  } else delete b.lineCount;
  update("learn_files", f.id, b, {
    path: ["path", filePath],
    language: ["language", v => text(v, 40, "the language")],
    content: ["content", v => v],
    lineCount: ["line_count", v => v],
    position: ["position", position],
  });
  res.json(fullLesson(getRow("learn_lessons", f.lesson_id), { owner: true }));
}));

adminLearnRouter.delete("/learn/files/:id", (req, res) => {
  const f = getRow("learn_files", req.params.id);
  if (!f) return notFound(res, "File");
  db.prepare("DELETE FROM learn_files WHERE id = ?").run(f.id);
  res.json(fullLesson(getRow("learn_lessons", f.lesson_id), { owner: true }));
});

// ---------- Clips ----------
const clipSpan = (start, end) => {
  if (end !== null && end <= start) fail("The clip must end after it starts.");
};

adminLearnRouter.post("/learn/lessons/:id/clips", handle((req, res) => {
  const l = getRow("learn_lessons", req.params.id);
  if (!l) return notFound(res, "Lesson");
  const b = req.body ?? {};
  const yt = parseYouTube(b.video) ?? fail("Paste a YouTube link or video ID.");
  const start = b.start === undefined ? 0 : seconds(b.start, "The start");
  const end = b.end === undefined || b.end === null ? null : seconds(b.end, "The end");
  clipSpan(start, end);
  db.prepare(`INSERT INTO learn_clips (lesson_id, youtube_id, title, channel_name, channel_url, start_s, end_s, form, status, position, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?)`).run(
    l.id, yt.id, text(b.title, 200, "the video's title", { required: true }), text(b.channelName, 100, "the channel's name"),
    webLink(b.channelUrl, "the channel link"), start, end, oneOf(b.form ?? (yt.short ? "short" : "long"), ["short", "long"], "Form"),
    b.position === undefined ? nextPosition("learn_clips", "lesson_id", l.id) : position(b.position), now());
  res.status(201).json(fullLesson(l, { owner: true }));
}));

adminLearnRouter.patch("/learn/clips/:id", handle((req, res) => {
  const c = getRow("learn_clips", req.params.id);
  if (!c) return notFound(res, "Clip");
  const b = req.body ?? {};
  const start = b.start === undefined ? c.start_s : seconds(b.start, "The start");
  const end = b.end === undefined ? c.end_s : b.end === null ? null : seconds(b.end, "The end");
  clipSpan(start, end);
  const outside = db.prepare("SELECT 1 FROM learn_links WHERE clip_id = ? AND (start_s < ? OR (? IS NOT NULL AND end_s > ?))").get(c.id, start, end, end);
  if (outside) fail("Some code links fall outside the new start and end. Change or delete those links first.");
  update("learn_clips", c.id, { ...b, start: b.start === undefined ? undefined : start, end: b.end === undefined ? undefined : end }, {
    title: ["title", v => text(v, 200, "the video's title", { required: true })],
    channelName: ["channel_name", v => text(v, 100, "the channel's name")],
    channelUrl: ["channel_url", v => webLink(v, "the channel link")],
    start: ["start_s", v => v],
    end: ["end_s", v => v],
    form: ["form", v => oneOf(v, ["short", "long"], "Form")],
    status: ["status", v => oneOf(v, ["live", "hidden"], "Status")],
    position: ["position", position],
  });
  res.json(fullLesson(getRow("learn_lessons", c.lesson_id), { owner: true }));
}));

adminLearnRouter.delete("/learn/clips/:id", (req, res) => {
  const c = getRow("learn_clips", req.params.id);
  if (!c) return notFound(res, "Clip");
  db.prepare("DELETE FROM learn_clips WHERE id = ?").run(c.id);
  res.json(fullLesson(getRow("learn_lessons", c.lesson_id), { owner: true }));
});

// ---------- Links between clip moments and code lines ----------
adminLearnRouter.post("/learn/clips/:id/links", handle((req, res) => {
  const c = getRow("learn_clips", req.params.id);
  if (!c) return notFound(res, "Clip");
  const b = req.body ?? {};
  const f = getRow("learn_files", b.fileId === undefined ? "" : String(b.fileId));
  if (!f || f.lesson_id !== c.lesson_id) fail("Pick a code file from this lesson.");
  const start = seconds(b.start, "The start"), end = seconds(b.end, "The end");
  if (end <= start) fail("The link must end after it starts.");
  if (start < c.start_s || (c.end_s !== null && end > c.end_s)) fail("The link must be inside the clip's start and end.");
  const [from, to] = Array.isArray(b.lines) ? b.lines : [];
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) fail("Give the first and last line, like [3, 8].");
  if (to > f.line_count) fail(`That file only has ${f.line_count} lines.`);
  db.prepare("INSERT INTO learn_links (clip_id, file_id, start_s, end_s, line_start, line_end, note) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(c.id, f.id, start, end, from, to, text(b.note, 200, "the note"));
  res.status(201).json(fullLesson(getRow("learn_lessons", c.lesson_id), { owner: true }));
}));

adminLearnRouter.delete("/learn/links/:id", (req, res) => {
  const k = db.prepare("SELECT k.id, c.lesson_id FROM learn_links k JOIN learn_clips c ON c.id = k.clip_id WHERE k.id = ?").get(idParam(req.params.id));
  if (!k) return notFound(res, "Link");
  db.prepare("DELETE FROM learn_links WHERE id = ?").run(k.id);
  res.json(fullLesson(getRow("learn_lessons", k.lesson_id), { owner: true }));
});

// People can report a clip (wrong, broken or inappropriate); the owner can hide it.
const reportableClip = id => db.prepare(`SELECT c.*, l.status AS lesson_status, t.status AS track_status FROM learn_clips c
  JOIN learn_lessons l ON l.id = c.lesson_id JOIN learn_tracks t ON t.id = l.track_id WHERE c.id = ?`).get(idParam(id));
registerReportTarget("clip", {
  exists: id => {
    const c = reportableClip(id);
    return !!c && c.status === "live" && c.lesson_status === "published" && c.track_status === "published";
  },
  describe: id => {
    const c = reportableClip(id);
    return c && { title: c.title, url: `/learn/lesson?id=${c.lesson_id}`, ownerUserId: null, state: c.status };
  },
  hide: id => db.prepare("UPDATE learn_clips SET status = 'hidden' WHERE id = ?").run(idParam(id)).changes > 0,
});
