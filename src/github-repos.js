// GitHub repos on creator pages. A creator names their GitHub account; the page lists
// their newest public repositories, fetched from GitHub's public API and cached so a
// busy page doesn't use up GitHub's rate limit. Only public data is ever shown.
import express from "express";
import { db, now, addColumn } from "./db.js";
import { requireUser } from "./auth.js";
import { rateLimit } from "./limit.js";
import "./creators.js"; // creates creator_profiles before the column is added

addColumn("creator_profiles", "github", "TEXT");

// GitHub usernames: letters, digits and single hyphens, up to 39 characters.
export const GITHUB_RE = /^(?!-)(?!.*--)[a-zA-Z0-9-]{1,39}(?<!-)$/;
const TTL_MS = 60 * 60_000;
const cache = new Map();
export const clearRepoCache = () => cache.clear();

export async function reposOf(username) {
  const key = username.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.repos;
  const r = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=pushed&per_page=12&type=owner`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "ForgeCenter" },
  });
  if (!r.ok) throw new Error(r.status === 404 ? "missing" : `GitHub said ${r.status}`);
  const repos = (await r.json()).filter(x => !x.fork && !x.private).slice(0, 8).map(x => ({
    name: String(x.name).slice(0, 100), description: String(x.description ?? "").slice(0, 200),
    url: `https://github.com/${encodeURIComponent(x.owner?.login ?? username)}/${encodeURIComponent(x.name)}`,
    language: x.language ? String(x.language).slice(0, 30) : null, stars: Number(x.stargazers_count) || 0,
  }));
  cache.set(key, { repos, expires: Date.now() + TTL_MS });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return repos;
}

export const githubRouter = express.Router();

githubRouter.put("/mine/github", requireUser, rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
  const raw = String(req.body?.username ?? "").trim().replace(/^@/, "").replace(/^https?:\/\/github\.com\//i, "").replace(/\/.*$/, "");
  if (raw && !GITHUB_RE.test(raw)) return res.status(400).json({ error: "That isn't a GitHub username. It's the name in your profile link, like github.com/steve." });
  const r = db.prepare("UPDATE creator_profiles SET github = ?, updated_at = ? WHERE user_id = ?").run(raw || null, now(), req.user.id);
  if (!r.changes) return res.status(409).json({ error: "Make your creator page first, then add GitHub." });
  res.json({ github: raw || null });
});

// Public: the repos for a visible creator page.
githubRouter.get("/:handle/repos", async (req, res) => {
  const row = db.prepare(`SELECT p.github FROM creator_profiles p JOIN users u ON u.id = p.user_id
    WHERE p.handle = ? AND p.hidden = 0 AND u.suspended_at IS NULL`).get(String(req.params.handle).toLowerCase());
  if (!row?.github) return res.json({ github: null, repos: [] });
  try { res.json({ github: row.github, repos: await reposOf(row.github) }); }
  catch (e) {
    if (e.message !== "missing") console.error("GitHub repos failed", e.message);
    res.json({ github: row.github, repos: [], unavailable: true });
  }
});
