// Reports and moderation. Anyone signed in can report a repo, an item or a profile;
// owners (ADMIN_EMAILS) review them and can suspend accounts. A suspended account's
// repos, items and profile disappear from public view, and owners can't be suspended.
import express from "express";
import { db, now } from "./db.js";
import { isAdmin, requireAdmin, requireUser } from "./auth.js";
import { rateLimit } from "./limit.js";

export const REASONS = ["scam", "malware", "stolen", "game-accounts", "adult", "hate", "spam", "other"];
const TARGETS = {
  repo: id => /^[a-z0-9-]+\/[A-Za-z0-9._-]+$/.test(id) && !!db.prepare(`SELECT 1 FROM repos r JOIN users u ON u.id = r.user_id
    WHERE u.username || '/' || r.name = ? AND r.private = 0`).get(id),
  product: id => /^\d+$/.test(id) && !!db.prepare("SELECT 1 FROM products WHERE id = ? AND active = 1").get(Number(id)),
  user: id => !!db.prepare("SELECT 1 FROM users WHERE username = ?").get(id),
};

export const reportsRouter = express.Router();
reportsRouter.post("/", requireUser, rateLimit({ windowMs: 60 * 60_000, max: 20 }), (req, res) => {
  const { type, target, reason } = req.body ?? {};
  if (!TARGETS[type] || !TARGETS[type](String(target ?? ""))) return res.status(404).json({ error: "We couldn't find what you're reporting." });
  if (!REASONS.includes(reason)) return res.status(400).json({ error: "Pick a reason." });
  if (db.prepare("SELECT 1 FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'").get(req.user.id, type, target)) {
    return res.json({ ok: true, already: true });
  }
  db.prepare("INSERT INTO reports (reporter_id, target_type, target_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(req.user.id, type, String(target), reason, String(req.body?.details ?? "").slice(0, 1000), now());
  res.status(201).json({ ok: true });
});

export const adminRouter = express.Router();
adminRouter.use(requireAdmin);
adminRouter.get("/reports", (req, res) => {
  res.json({ reports: db.prepare(`SELECT r.*, u.username AS reporter FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
    WHERE r.status = 'open' ORDER BY r.id DESC LIMIT 200`).all() });
});
adminRouter.post("/reports/:id/close", (req, res) => {
  db.prepare("UPDATE reports SET status = 'closed' WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});
adminRouter.post("/users/:username/suspend", (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE username = ?").get(String(req.params.username));
  if (!u) return res.status(404).json({ error: "No such user." });
  if (isAdmin(u)) return res.status(403).json({ error: "Owner accounts can't be suspended." });
  db.prepare("UPDATE users SET suspended_at = ? WHERE id = ?").run(req.body?.suspend === false ? null : now(), u.id);
  res.json({ ok: true });
});
adminRouter.get("/stats", (req, res) => {
  const n = sql => db.prepare(sql).get().n;
  res.json({ users: n("SELECT COUNT(*) AS n FROM users"), repos: n("SELECT COUNT(*) AS n FROM repos"),
    files: n("SELECT COUNT(*) AS n FROM repo_files"), bytes: n("SELECT COALESCE(SUM(size), 0) AS n FROM repo_files"),
    sales: n("SELECT COUNT(*) AS n FROM purchases WHERE status = 'paid'"), openReports: n("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'") });
});
