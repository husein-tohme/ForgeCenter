// Repositories: any files you like, browsed and edited in the browser, with a commit
// history, stars, zip downloads and a live preview for websites. Files live in the
// database, so limits keep one person from filling it up.
import express from "express";
import archiver from "archiver";
import { createHash } from "node:crypto";
import { db, now } from "./db.js";
import { isAdmin, requireUser } from "./auth.js";
import { rateLimit } from "./limit.js";

export const LIMITS = { fileBytes: 10 * 1024 * 1024, repoBytes: 100 * 1024 * 1024, userBytes: 250 * 1024 * 1024, files: 2000, repos: 100, textBytes: 1024 * 1024 };
export const REPO_NAME_RE = /^[A-Za-z0-9._-]{1,60}$/;
const SEGMENT_RE = /^[\w.\- ()+@,=!']{1,100}$/;

// "src/app.js" yes; "../x", "/x", "a//b" or "." no.
export function cleanPath(raw) {
  const path = String(raw ?? "").trim().replace(/\\/g, "/");
  const parts = path.split("/");
  if (!path || path.length > 300 || parts.length > 12) return null;
  return parts.every(p => SEGMENT_RE.test(p) && p !== "." && p !== "..") ? path : null;
}

const sha = buf => createHash("sha256").update(buf).digest("hex");
// Text if it has no NUL bytes and is valid UTF-8, so it can be shown and edited.
export function asText(buf) {
  if (buf.length > LIMITS.textBytes || buf.subarray(0, 8000).includes(0)) return null;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return null; }
}

// The repo if this viewer may see it: public ones for everyone (unless the owner is
// suspended), private ones only for their owner and site owners.
export function findRepo(owner, name, viewer) {
  const r = db.prepare(`SELECT r.*, u.username AS owner, u.suspended_at FROM repos r JOIN users u ON u.id = r.user_id
    WHERE u.username = ? AND r.name = ? COLLATE NOCASE`).get(String(owner).toLowerCase(), String(name));
  if (!r) return null;
  const mine = viewer?.id === r.user_id;
  if ((r.private || r.suspended_at) && !mine && !isAdmin(viewer)) return null;
  return { ...r, mine };
}

const repoJson = r => ({ id: r.id, owner: r.owner, name: r.name, description: r.description, private: !!r.private,
  stars: r.stars, createdAt: r.created_at, updatedAt: r.updated_at });

function commit(repoId, userId, message, changes) {
  const t = now();
  db.prepare("INSERT INTO commits (repo_id, user_id, message, changes, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(repoId, userId, String(message || "").trim().slice(0, 200) || defaultMessage(changes), JSON.stringify(changes), t);
  db.prepare("UPDATE repos SET updated_at = ? WHERE id = ?").run(t, repoId);
}
const defaultMessage = changes => changes.length === 1
  ? `${{ add: "Add", edit: "Update", delete: "Delete" }[changes[0].op]} ${changes[0].path}` : `Change ${changes.length} files`;

export const reposRouter = express.Router();

reposRouter.get("/explore", (req, res) => {
  const q = String(req.query.q ?? "").trim().slice(0, 60);
  const rows = db.prepare(`SELECT r.*, u.username AS owner FROM repos r JOIN users u ON u.id = r.user_id
    WHERE r.private = 0 AND u.suspended_at IS NULL AND (? = '' OR r.name LIKE ? OR r.description LIKE ? OR u.username LIKE ?)
    ORDER BY ${req.query.sort === "stars" ? "r.stars DESC," : ""} r.updated_at DESC LIMIT 60`).all(q, `%${q}%`, `%${q}%`, `%${q}%`);
  res.json({ repos: rows.map(repoJson) });
});

reposRouter.get("/user/:username", (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE username = ?").get(String(req.params.username).toLowerCase());
  const self = u && req.user?.id === u.id;
  if (!u || (u.suspended_at && !self && !isAdmin(req.user))) return res.status(404).json({ error: "No one has that username." });
  const repos = db.prepare(`SELECT r.*, ? AS owner FROM repos r WHERE r.user_id = ? AND (r.private = 0 OR ?) ORDER BY r.updated_at DESC`)
    .all(u.username, u.id, self ? 1 : 0);
  res.json({
    user: { username: u.username, name: u.name, picture: u.picture, bio: u.bio, website: u.website, joinedAt: u.created_at, canSell: !!u.stripe_charges_enabled },
    repos: repos.map(repoJson), self,
  });
});

reposRouter.post("/", requireUser, rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!REPO_NAME_RE.test(name) || /^\.+$/.test(name)) return res.status(400).json({ error: "Repo names use letters, numbers, dots, dashes and underscores, up to 60 characters." });
  if (db.prepare("SELECT COUNT(*) AS n FROM repos WHERE user_id = ?").get(req.user.id).n >= LIMITS.repos) return res.status(409).json({ error: `You can have up to ${LIMITS.repos} repos.` });
  if (db.prepare("SELECT 1 FROM repos WHERE user_id = ? AND name = ? COLLATE NOCASE").get(req.user.id, name)) return res.status(409).json({ error: "You already have a repo with that name." });
  const t = now();
  const r = db.prepare("INSERT INTO repos (user_id, name, description, private, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *")
    .get(req.user.id, name, String(req.body?.description ?? "").trim().slice(0, 200), req.body?.private ? 1 : 0, t, t);
  if (req.body?.readme) {
    const buf = Buffer.from(`# ${name}\n\n${r.description || "A new Forgehub repo."}\n`);
    db.prepare("INSERT INTO repo_files (repo_id, path, size, sha256, data, updated_at) VALUES (?, 'README.md', ?, ?, ?, ?)").run(r.id, buf.length, sha(buf), buf, t);
    commit(r.id, req.user.id, "Initial commit", [{ op: "add", path: "README.md" }]);
  }
  res.status(201).json({ repo: repoJson({ ...r, owner: req.user.username }) });
});

reposRouter.get("/:owner/:name", (req, res) => {
  const r = findRepo(req.params.owner, req.params.name, req.user);
  if (!r) return res.status(404).json({ error: "That repo doesn't exist, or it's private." });
  const files = db.prepare("SELECT path, size, updated_at FROM repo_files WHERE repo_id = ? ORDER BY path").all(r.id);
  const readmeRow = db.prepare("SELECT data FROM repo_files WHERE repo_id = ? AND path COLLATE NOCASE IN ('README.md', 'README.txt', 'README') LIMIT 1").get(r.id);
  const commits = db.prepare(`SELECT c.id, c.message, c.changes, c.created_at, u.username FROM commits c LEFT JOIN users u ON u.id = c.user_id
    WHERE c.repo_id = ? ORDER BY c.id DESC LIMIT 30`).all(r.id);
  res.json({
    repo: repoJson(r), mine: r.mine,
    starred: !!(req.user && db.prepare("SELECT 1 FROM stars WHERE user_id = ? AND repo_id = ?").get(req.user.id, r.id)),
    files: files.map(f => ({ path: f.path, size: f.size, updatedAt: f.updated_at })),
    totalBytes: files.reduce((n, f) => n + f.size, 0),
    readme: readmeRow ? asText(Buffer.from(readmeRow.data)) : null,
    hasSite: files.some(f => f.path === "index.html"),
    commits: commits.map(c => ({ id: c.id, message: c.message, changes: JSON.parse(c.changes), at: c.created_at, by: c.username })),
  });
});

reposRouter.patch("/:owner/:name", requireUser, (req, res) => {
  const r = findRepo(req.params.owner, req.params.name, req.user);
  if (!r?.mine) return res.status(404).json({ error: "That isn't your repo." });
  if (typeof req.body?.description === "string") db.prepare("UPDATE repos SET description = ? WHERE id = ?").run(req.body.description.trim().slice(0, 200), r.id);
  if (typeof req.body?.private === "boolean") db.prepare("UPDATE repos SET private = ? WHERE id = ?").run(req.body.private ? 1 : 0, r.id);
  res.json({ repo: repoJson({ ...db.prepare("SELECT * FROM repos WHERE id = ?").get(r.id), owner: r.owner }) });
});

reposRouter.delete("/:owner/:name", requireUser, (req, res) => {
  const r = findRepo(req.params.owner, req.params.name, req.user);
  if (!r?.mine) return res.status(404).json({ error: "That isn't your repo." });
  if (req.body?.confirm !== r.name) return res.status(400).json({ error: `Type the repo name (${r.name}) to delete it.` });
  db.prepare("DELETE FROM repos WHERE id = ?").run(r.id);
  res.json({ ok: true });
});

reposRouter.post("/:owner/:name/star", requireUser, (req, res) => {
  const r = findRepo(req.params.owner, req.params.name, req.user);
  if (!r) return res.status(404).json({ error: "That repo doesn't exist." });
  const had = db.prepare("DELETE FROM stars WHERE user_id = ? AND repo_id = ?").run(req.user.id, r.id).changes;
  if (!had) db.prepare("INSERT INTO stars (user_id, repo_id) VALUES (?, ?)").run(req.user.id, r.id);
  const stars = db.prepare("SELECT COUNT(*) AS n FROM stars WHERE repo_id = ?").get(r.id).n;
  db.prepare("UPDATE repos SET stars = ? WHERE id = ?").run(stars, r.id);
  res.json({ starred: !had, stars });
});

// One file, for viewing: text comes back as text; anything else as a download link.
reposRouter.get("/:owner/:name/file", (req, res) => {
  const r = findRepo(req.params.owner, req.params.name, req.user);
  const path = cleanPath(req.query.path);
  const f = r && path && db.prepare("SELECT path, size, data, updated_at FROM repo_files WHERE repo_id = ? AND path = ?").get(r.id, path);
  if (!f) return res.status(404).json({ error: "That file doesn't exist." });
  res.json({ path: f.path, size: f.size, updatedAt: f.updated_at, text: asText(Buffer.from(f.data)) });
});

// Upload or save a file: the body is the raw file. The CSRF guard in app.js lets this
// one route take application/octet-stream, from this site only.
reposRouter.put("/:owner/:name/file", requireUser, rateLimit({ windowMs: 60_000, max: 300 }),
  express.raw({ type: "application/octet-stream", limit: LIMITS.fileBytes }), (req, res) => {
    const r = findRepo(req.params.owner, req.params.name, req.user);
    if (!r?.mine) return res.status(404).json({ error: "That isn't your repo." });
    const path = cleanPath(req.query.path);
    if (!path) return res.status(400).json({ error: "File paths use letters, numbers, spaces and . - _ ( ) characters, with folders separated by /." });
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const old = db.prepare("SELECT size, sha256 FROM repo_files WHERE repo_id = ? AND path = ?").get(r.id, path);
    if (old?.sha256 === sha(buf)) return res.json({ path, size: buf.length, unchanged: true });
    const grow = buf.length - (old?.size ?? 0);
    const used = db.prepare("SELECT COALESCE(SUM(size), 0) AS n, COUNT(*) AS c FROM repo_files WHERE repo_id = ?").get(r.id);
    const userUsed = db.prepare("SELECT COALESCE(SUM(f.size), 0) AS n FROM repo_files f JOIN repos x ON x.id = f.repo_id WHERE x.user_id = ?").get(req.user.id).n;
    if (!old && used.c >= LIMITS.files) return res.status(413).json({ error: `A repo can hold up to ${LIMITS.files} files.` });
    if (used.n + grow > LIMITS.repoBytes) return res.status(413).json({ error: "This repo is full (100 MB). Delete some files or make another repo." });
    if (userUsed + grow > LIMITS.userBytes) return res.status(413).json({ error: "Your account is full (250 MB). Delete some files first." });
    // A file and a folder can't share a name.
    if (db.prepare("SELECT 1 FROM repo_files WHERE repo_id = ? AND (path LIKE ? ESCAPE '\\' OR ? LIKE path || '/%')").get(r.id, path.replace(/[%_\\]/g, "\\$&") + "/%", path)) {
      return res.status(409).json({ error: "A file and a folder can't have the same name." });
    }
    db.prepare(`INSERT INTO repo_files (repo_id, path, size, sha256, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (repo_id, path) DO UPDATE SET size = excluded.size, sha256 = excluded.sha256, data = excluded.data, updated_at = excluded.updated_at`)
      .run(r.id, path, buf.length, sha(buf), buf, now());
    if (req.query.commit !== "0") commit(r.id, req.user.id, req.query.message, [{ op: old ? "edit" : "add", path }]);
    res.json({ path, size: buf.length });
  });

// After a batch upload with commit=0, one commit lists every file.
reposRouter.post("/:owner/:name/commit", requireUser, (req, res) => {
  const r = findRepo(req.params.owner, req.params.name, req.user);
  if (!r?.mine) return res.status(404).json({ error: "That isn't your repo." });
  const paths = (Array.isArray(req.body?.paths) ? req.body.paths : []).map(cleanPath).filter(Boolean).slice(0, LIMITS.files);
  if (!paths.length) return res.status(400).json({ error: "Nothing to commit." });
  commit(r.id, req.user.id, req.body?.message, paths.map(path => ({ op: "add", path })));
  res.json({ ok: true });
});

reposRouter.delete("/:owner/:name/file", requireUser, (req, res) => {
  const r = findRepo(req.params.owner, req.params.name, req.user);
  if (!r?.mine) return res.status(404).json({ error: "That isn't your repo." });
  const path = cleanPath(req.query.path);
  if (!path || !db.prepare("DELETE FROM repo_files WHERE repo_id = ? AND path = ?").run(r.id, path).changes) return res.status(404).json({ error: "That file doesn't exist." });
  commit(r.id, req.user.id, req.body?.message, [{ op: "delete", path }]);
  res.json({ ok: true });
});

// ---------- Downloads and live sites (outside /api) ----------
export const filesRouter = express.Router();

const downloadName = s => s.replace(/[^\w.\- ]/g, "_");
filesRouter.get("/raw/:owner/:name/*", (req, res, next) => {
  const r = findRepo(req.params.owner, req.params.name, req.user);
  const path = cleanPath(req.params[0]);
  const f = r && path && db.prepare("SELECT data FROM repo_files WHERE repo_id = ? AND path = ?").get(r.id, path);
  if (!f) return next();
  // Always a download, never rendered here: an uploaded page can't run on this site.
  res.set({ "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${downloadName(path.split("/").pop())}"`,
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" });
  res.send(Buffer.from(f.data));
});

filesRouter.get("/zip/:owner/:name", (req, res, next) => {
  const r = findRepo(req.params.owner, req.params.name, req.user);
  if (!r) return next();
  res.set({ "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${downloadName(r.name)}.zip"` });
  const zip = archiver("zip");
  zip.pipe(res);
  for (const f of db.prepare("SELECT path, data FROM repo_files WHERE repo_id = ? ORDER BY path").iterate(r.id)) zip.append(Buffer.from(f.data), { name: `${r.name}/${f.path}` });
  zip.finalize();
});

const TYPES = { html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript", json: "application/json",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon",
  txt: "text/plain", md: "text/plain", wasm: "application/wasm", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", mp4: "video/mp4",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf" };
// Live preview of a public repo's website. The sandbox header without allow-same-origin
// gives the page an opaque origin, so its scripts run but can never read Forgehub's
// cookies or call its API as the visitor.
filesRouter.get(["/p/:owner/:name", "/p/:owner/:name/*"], (req, res, next) => {
  if (!req.params[0] && !req.path.endsWith("/")) return res.redirect(301, `${req.originalUrl.split("?")[0]}/`);
  const r = findRepo(req.params.owner, req.params.name, null);
  if (!r) return next();
  let path = req.params[0] || "index.html";
  if (path.endsWith("/")) path += "index.html";
  path = cleanPath(path);
  const f = path && db.prepare("SELECT data FROM repo_files WHERE repo_id = ? AND path = ?").get(r.id, path);
  if (!f) return res.status(404).type("text/plain").send("Not found in this repo.");
  res.set({ "Content-Type": TYPES[path.split(".").pop().toLowerCase()] ?? "application/octet-stream", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-modals allow-pointer-lock", "Cache-Control": "no-cache",
    // The sandboxed page has its own opaque origin, so its CSS and scripts load cross-origin.
    "Cross-Origin-Resource-Policy": "cross-origin" });
  res.send(Buffer.from(f.data));
});
