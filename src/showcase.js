// Public showcase. Each paid "showcase" order allows one listing; the site owner approves it.
import express from "express";
import { db, now } from "./db.js";
import { requireAdmin, requireUser } from "./auth.js";

export const showcaseRouter = express.Router();

const unusedCredit = userId => db.prepare(`SELECT o.id FROM orders o
  WHERE o.user_id = ? AND o.product = 'showcase' AND o.status IN ('paid', 'in_progress', 'delivered')
    AND NOT EXISTS (SELECT 1 FROM showcase s WHERE s.order_id = o.id)
  ORDER BY o.id LIMIT 1`).get(userId);

showcaseRouter.get("/", (_req, res) => {
  const rows = db.prepare(`SELECT s.id, s.title, s.url, s.description, u.name AS owner
    FROM showcase s JOIN users u ON u.id = s.user_id WHERE s.status = 'approved' ORDER BY s.id DESC LIMIT 60`).all();
  res.json({ listings: rows });
});

showcaseRouter.get("/mine", requireUser, (req, res) => {
  const listings = db.prepare("SELECT id, title, url, description, status FROM showcase WHERE user_id = ? ORDER BY id DESC").all(req.user.id);
  const credits = db.prepare(`SELECT COUNT(*) AS n FROM orders o WHERE o.user_id = ? AND o.product = 'showcase'
    AND o.status IN ('paid', 'in_progress', 'delivered') AND NOT EXISTS (SELECT 1 FROM showcase s WHERE s.order_id = o.id)`).get(req.user.id).n;
  res.json({ listings, credits });
});

showcaseRouter.post("/", requireUser, (req, res) => {
  const title = String(req.body?.title ?? "").trim().slice(0, 80);
  const url = String(req.body?.url ?? "").trim().slice(0, 300);
  const description = String(req.body?.description ?? "").trim().slice(0, 300);
  if (!title) return res.status(400).json({ error: "Give your listing a title." });
  if (!/^https?:\/\/\S+$/i.test(url)) return res.status(400).json({ error: "The link must start with http:// or https://." });
  const credit = unusedCredit(req.user.id);
  if (!credit) return res.status(402).json({ error: "Buy a showcase slot to add a listing." });
  db.prepare("INSERT INTO showcase (user_id, order_id, title, url, description, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(req.user.id, credit.id, title, url, description, now());
  res.status(201).json({ ok: true });
});

showcaseRouter.delete("/:id", requireUser, (req, res) => {
  const r = db.prepare("DELETE FROM showcase WHERE id = ? AND user_id = ?").run(Number(req.params.id), req.user.id);
  if (!r.changes) return res.status(404).json({ error: "Listing not found." });
  res.json({ ok: true });
});

export const adminShowcaseRouter = express.Router();
adminShowcaseRouter.use(requireUser, requireAdmin);

adminShowcaseRouter.get("/showcase", (_req, res) => {
  const rows = db.prepare(`SELECT s.id, s.title, s.url, s.description, s.status, COALESCE(u.email, u.phone, u.name) AS owner
    FROM showcase s JOIN users u ON u.id = s.user_id ORDER BY s.status = 'pending' DESC, s.id DESC LIMIT 200`).all();
  res.json({ listings: rows });
});

adminShowcaseRouter.patch("/showcase/:id", (req, res) => {
  const status = req.body?.status;
  if (!["pending", "approved", "hidden"].includes(status)) return res.status(400).json({ error: "Unknown status." });
  const r = db.prepare("UPDATE showcase SET status = ? WHERE id = ?").run(status, Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: "Listing not found." });
  res.json({ ok: true });
});
