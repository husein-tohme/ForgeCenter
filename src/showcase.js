// Public showcase. Each paid "showcase" order allows one listing; the site owner approves it.
// Listings marked 18+ are only shown to confirmed adults, like Discord's age-restricted
// channels; everyone else sees that one is there and can confirm their age.
import express from "express";
import { db, now } from "./db.js";
import { isAdult, requireAdmin, requireUser } from "./auth.js";

export const showcaseRouter = express.Router();

const unusedCredit = userId => db.prepare(`SELECT o.id FROM orders o
  WHERE o.user_id = ? AND o.product = 'showcase' AND o.status IN ('paid', 'in_progress', 'delivered')
    AND NOT EXISTS (SELECT 1 FROM showcase s WHERE s.order_id = o.id)
  ORDER BY o.id LIMIT 1`).get(userId);

showcaseRouter.get("/", (req, res) => {
  const rows = db.prepare(`SELECT s.id, s.title, s.url, s.description, s.adult_only, u.name AS owner
    FROM showcase s JOIN users u ON u.id = s.user_id WHERE s.status = 'approved' ORDER BY s.id DESC LIMIT 60`).all();
  const adult = isAdult(req.user);
  res.json({ listings: rows.map(({ adult_only, ...l }) =>
    !adult_only ? l : adult ? { ...l, adultOnly: true } : { id: l.id, adultOnly: true, restricted: true }) });
});

showcaseRouter.get("/mine", requireUser, (req, res) => {
  const listings = db.prepare(`SELECT id, title, url, description, status, adult_only = 1 AS adultOnly
    FROM showcase WHERE user_id = ? ORDER BY id DESC`).all(req.user.id).map(l => ({ ...l, adultOnly: !!l.adultOnly }));
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
  const adultOnly = req.body?.adultOnly === true;
  if (adultOnly && !isAdult(req.user)) return res.status(403).json({ error: "Only confirmed adults can post 18+ listings.", needs: "adult" });
  const credit = unusedCredit(req.user.id);
  if (!credit) return res.status(402).json({ error: "Buy a showcase slot to add a listing." });
  db.prepare("INSERT INTO showcase (user_id, order_id, title, url, description, adult_only, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(req.user.id, credit.id, title, url, description, adultOnly ? 1 : 0, now());
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
  const rows = db.prepare(`SELECT s.id, s.title, s.url, s.description, s.status, s.adult_only = 1 AS adultOnly,
      COALESCE(u.email, u.phone, u.name) AS owner
    FROM showcase s JOIN users u ON u.id = s.user_id ORDER BY s.status = 'pending' DESC, s.id DESC LIMIT 200`).all();
  res.json({ listings: rows.map(l => ({ ...l, adultOnly: !!l.adultOnly })) });
});

// The owner can approve or hide a listing, and mark it 18+ if its owner didn't.
adminShowcaseRouter.patch("/showcase/:id", (req, res) => {
  const { status, adultOnly } = req.body ?? {};
  if (status !== undefined && !["pending", "approved", "hidden"].includes(status)) return res.status(400).json({ error: "Unknown status." });
  if (adultOnly !== undefined && typeof adultOnly !== "boolean") return res.status(400).json({ error: "adultOnly must be true or false." });
  const r = db.prepare("UPDATE showcase SET status = COALESCE(?, status), adult_only = COALESCE(?, adult_only) WHERE id = ?")
    .run(status ?? null, adultOnly === undefined ? null : adultOnly ? 1 : 0, Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: "Listing not found." });
  res.json({ ok: true });
});
