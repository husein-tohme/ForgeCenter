// Reports and moderation. Anyone signed in can report something that breaks the rules
// (public/rules.html); the site owner reviews reports, hides content and suspends
// accounts. A suspended account can still sign in, read its own details and open
// support tickets to appeal, but every other signed-in route turns it away (auth.js).
import express from "express";
import { db, now } from "./db.js";
import { isAdmin, requireAdmin, requireUser } from "./auth.js";
import { rateLimit } from "./limit.js";

db.exec(`
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_note TEXT
);
CREATE INDEX IF NOT EXISTS reports_status ON reports(status, id);
CREATE INDEX IF NOT EXISTS reports_target ON reports(target_type, target_id);
`);

export const REASONS = {
  scam: "Scam or phishing",
  inappropriate: "Inappropriate or 18+ content",
  stolen: "Stolen or reuploaded work",
  harassment: "Harassment or hate",
  spam: "Spam",
  other: "Something else",
};
const STATUSES = ["open", "dismissed", "actioned"];
const MAX_DETAILS = 1000;

// ---------- Things that can be reported ----------
// Other features plug in their own content: exists(id) says whether people can see it
// (and so report it); describe(id) returns { title, url, ownerUserId } for the owner
// panel, or null once it's gone. hide(id), if given, takes it down.
const targets = new Map();
export function registerReportTarget(type, { exists, describe, hide = null }) {
  if (!/^[a-z][a-z0-9_]{0,30}$/.test(type)) throw new Error(`Bad report target type: ${type}`);
  targets.set(type, { exists, describe, hide });
}

// Listing ids must be written the one way ("7", not "07"), so the one-open-report rule
// can't be dodged by spelling the same id differently.
const listingId = id => /^[1-9][0-9]{0,15}$/.test(id) ? Number(id) : null;
registerReportTarget("listing", {
  exists: id => listingId(id) !== null && !!db.prepare(`SELECT 1 FROM showcase s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.status = 'approved' AND u.suspended_at IS NULL`).get(listingId(id)),
  describe: id => {
    const l = db.prepare("SELECT title, url, user_id, status FROM showcase WHERE id = ?").get(Number(id));
    return l && { title: l.title, url: l.url, ownerUserId: l.user_id, state: l.status };
  },
  hide: id => db.prepare("UPDATE showcase SET status = 'hidden' WHERE id = ?").run(Number(id)).changes > 0,
});

// Report ids from the browser are short plain strings, never anything structured.
const cleanId = value => {
  const id = typeof value === "number" && Number.isInteger(value) ? String(value) : typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
};

// ---------- Reporting ----------
export const reportsRouter = express.Router();

reportsRouter.post("/", requireUser, rateLimit({ windowMs: 60 * 60_000, max: 10 }), (req, res) => {
  const { type, reason } = req.body ?? {};
  const target = typeof type === "string" ? targets.get(type) : null;
  const id = cleanId(req.body?.id);
  if (!target || !id) return res.status(400).json({ error: "That can't be reported. Refresh the page and try again." });
  if (!REASONS[reason]) return res.status(400).json({ error: "Choose a reason for your report." });
  const details = String(req.body?.details ?? "").trim();
  if (details.length > MAX_DETAILS) return res.status(400).json({ error: `Keep the details under ${MAX_DETAILS} characters.` });
  if (!target.exists(id)) return res.status(404).json({ error: "We couldn't find that. It may already have been removed." });
  if (target.describe(id)?.ownerUserId === req.user.id) return res.status(400).json({ error: "That's yours, so you can't report it. You can change or delete it from your account." });
  const open = db.prepare(`SELECT 1 FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'`)
    .get(req.user.id, type, id);
  if (open) return res.status(409).json({ error: "You've already reported this. The team will look at it soon." });
  db.prepare(`INSERT INTO reports (reporter_id, target_type, target_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(req.user.id, type, id, reason, details, now());
  res.status(201).json({ ok: true });
});

// ---------- Owner routes ----------
export const adminReportsRouter = express.Router();
adminReportsRouter.use(requireUser, requireAdmin);

const userSummary = id => {
  const u = id && db.prepare("SELECT id, name, email, phone, suspended_at, suspended_reason FROM users WHERE id = ?").get(id);
  return u ? { id: u.id, name: u.name, contact: u.email ?? u.phone ?? null, suspended: !!u.suspended_at, admin: isAdmin(u) } : null;
};

function adminReport(r) {
  const target = targets.get(r.target_type);
  const about = target?.describe(r.target_id) ?? null;
  // Links are shown in the owner panel, so only plain web addresses and paths on this site go out.
  const url = about?.url && /^(https?:\/\/\S+|\/[^\s/]\S*)$/i.test(about.url) ? about.url : null;
  return {
    id: r.id, type: r.target_type, targetId: r.target_id, reason: r.reason, reasonName: REASONS[r.reason] ?? r.reason,
    details: r.details, status: r.status, createdAt: r.created_at, resolvedAt: r.resolved_at, resolvedNote: r.resolved_note,
    reporter: userSummary(r.reporter_id),
    target: about ? { title: about.title, url, state: about.state ?? null, owner: userSummary(about.ownerUserId) } : null,
    canHide: !!(about && target.hide && about.state !== "hidden"),
  };
}

adminReportsRouter.get("/reports", (req, res) => {
  const status = String(req.query.status ?? "open");
  const rows = STATUSES.includes(status)
    ? db.prepare("SELECT * FROM reports WHERE status = ? ORDER BY id DESC LIMIT 200").all(status)
    : db.prepare("SELECT * FROM reports ORDER BY status = 'open' DESC, id DESC LIMIT 200").all();
  res.json({ reports: rows.map(adminReport), reasons: REASONS });
});

// Close a report as dismissed or actioned (optionally hiding what it's about), or reopen it.
adminReportsRouter.patch("/reports/:id", (req, res) => {
  const report = db.prepare("SELECT * FROM reports WHERE id = ?").get(Number(req.params.id));
  if (!report) return res.status(404).json({ error: "Report not found." });
  const { status, hide } = req.body ?? {};
  if (!STATUSES.includes(status)) return res.status(400).json({ error: "Choose open, dismissed or actioned." });
  const note = String(req.body?.note ?? "").trim().slice(0, 500);
  if (hide === true) {
    const target = targets.get(report.target_type);
    if (!target?.hide) return res.status(400).json({ error: "This kind of report can't hide anything. Mark it resolved instead." });
    if (!target.hide(report.target_id)) return res.status(404).json({ error: "That's already gone." });
  }
  const closed = status !== "open";
  db.prepare("UPDATE reports SET status = ?, resolved_at = ?, resolved_note = ? WHERE id = ?")
    .run(status, closed ? now() : null, closed ? note || null : null, report.id);
  res.json({ report: adminReport(db.prepare("SELECT * FROM reports WHERE id = ?").get(report.id)) });
});

// ---------- Suspensions ----------
adminReportsRouter.get("/users/suspended", (_req, res) => {
  const users = db.prepare(`SELECT id, name, email, phone, suspended_at, suspended_reason FROM users
    WHERE suspended_at IS NOT NULL ORDER BY suspended_at DESC LIMIT 200`).all();
  res.json({ users: users.map(u => ({ id: u.id, name: u.name, contact: u.email ?? u.phone ?? null, at: u.suspended_at, reason: u.suspended_reason })) });
});

function loadTarget(req, res, next) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(Number(req.params.id));
  if (!user) return res.status(404).json({ error: "Account not found." });
  req.target = user;
  next();
}

adminReportsRouter.post("/users/:id/suspend", loadTarget, (req, res) => {
  if (req.target.id === req.user.id) return res.status(400).json({ error: "You can't suspend your own account." });
  if (isAdmin(req.target)) return res.status(403).json({ error: "Owner accounts can't be suspended. Remove the address from ADMIN_EMAILS first." });
  const reason = String(req.body?.reason ?? "").trim().slice(0, 300);
  if (!reason) return res.status(400).json({ error: "Write the reason. The person sees it, so say which rule was broken." });
  db.prepare("UPDATE users SET suspended_at = ?, suspended_reason = ? WHERE id = ?").run(now(), reason, req.target.id);
  res.json({ user: userSummary(req.target.id) });
});

// Lifting always works, even for an account that was suspended before its address was
// added to ADMIN_EMAILS (otherwise that person could never get back in).
adminReportsRouter.post("/users/:id/unsuspend", loadTarget, (req, res) => {
  db.prepare("UPDATE users SET suspended_at = NULL, suspended_reason = NULL WHERE id = ?").run(req.target.id);
  res.json({ user: userSummary(req.target.id) });
});
