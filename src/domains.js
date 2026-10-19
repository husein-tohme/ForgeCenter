// Live sites on their own addresses.
// - Subdomains: with SITES_DOMAIN set (say forgehub.site, pointed at this server with a
//   wildcard DNS record), <user>.forgehub.site/<repo>/ serves that user's public repo.
//   A repo named <user>.forgehub.site is served at the root, like GitHub Pages.
// - Custom domains: a repo owner adds mygame.com, proves they own it with a TXT record
//   (_forgehub.mygame.com = the token), then points the domain here. Unverified domains
//   are never served, so nobody can claim a domain they don't control.
// Sites on these addresses aren't sandboxed: Forgehub's cookies never reach them.
import express from "express";
import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { db, now } from "./db.js";
import { requireUser } from "./auth.js";
import { rateLimit } from "./limit.js";
import { findRepo, serveSite } from "./repos.js";

export const DOMAIN_RE = /^(?=.{4,253}$)(?!-)(?:[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/;
const sitesDomain = () => (process.env.SITES_DOMAIN || "").toLowerCase().replace(/^\.+|\.+$/g, "");
const ownHost = () => { try { return new URL(process.env.BASE_URL).hostname; } catch { return null; } };
let lookupTxt = resolveTxt;
export const setTxtLookup = fn => { lookupTxt = fn ?? resolveTxt; };

// Runs before everything else: requests for a site's own address never reach Forgehub's pages or API.
export function siteHosts(req, res, next) {
  const host = String(req.hostname || "").toLowerCase();
  if (!host || host === ownHost() || host === "localhost" || host === "127.0.0.1" || req.path === "/healthz") return next();
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).type("text/plain").send("Sites are read-only.");
  const sd = sitesDomain();
  if (sd && host.endsWith(`.${sd}`)) {
    const user = host.slice(0, -sd.length - 1);
    if (user.includes(".")) return res.status(404).type("text/plain").send("No site here.");
    const path = decodeURIComponent(req.path.slice(1));
    // /<repo>/... first; anything else comes from the user's home repo, if they have one.
    const [repoName, ...rest] = path.split("/");
    const repo = repoName && repoName.toLowerCase() !== host && findRepo(user, repoName, null);
    if (repo) {
      if (!rest.length && !req.path.endsWith("/")) return res.redirect(301, `/${repoName}/`);
      return serveSite(res, repo, rest.join("/"), { sandbox: false });
    }
    const root = findRepo(user, host, null);
    if (root) return serveSite(res, root, path, { sandbox: false });
    return res.status(404).type("text/plain").send("No site here.");
  }
  const d = db.prepare(`SELECT d.repo_id, r.private, u.suspended_at FROM domains d JOIN repos r ON r.id = d.repo_id JOIN users u ON u.id = r.user_id
    WHERE d.domain = ? AND d.verified_at IS NOT NULL`).get(host.replace(/^www\./, ""));
  if (d && !d.private && !d.suspended_at) return serveSite(res, { id: d.repo_id }, decodeURIComponent(req.path.slice(1)), { sandbox: false });
  // A domain someone added but hasn't verified (or a stray one pointed here) gets no site,
  // and never Forgehub's own pages under someone else's name.
  const known = db.prepare("SELECT 1 FROM domains WHERE domain = ?").get(host.replace(/^www\./, ""));
  if (known || d || (ownHost() && host !== ownHost())) return res.status(404).type("text/plain").send("No site is set up for this address yet.");
  next();
}

export const domainsRouter = express.Router();

// For a reverse proxy that issues HTTPS certificates on demand (Caddy's "ask"): only
// verified domains and subdomains of SITES_DOMAIN get one.
domainsRouter.get("/allowed", (req, res) => {
  const d = String(req.query.domain ?? "").toLowerCase();
  const sd = sitesDomain();
  const ok = (sd && d.endsWith(`.${sd}`)) || !!db.prepare("SELECT 1 FROM domains WHERE domain = ? AND verified_at IS NOT NULL").get(d.replace(/^www\./, ""));
  res.status(ok ? 200 : 404).end();
});

const status = (row, r) => row && ({ domain: row.domain, verified: !!row.verified_at, txtName: `_forgehub.${row.domain}`, txtValue: row.token,
  target: ownHost() ?? "this server's address", live: !!row.verified_at && !r.private });

domainsRouter.get("/:owner/:name", requireUser, (req, res) => {
  const r = findRepo(req.params.owner, req.params.name, req.user);
  if (!r?.mine) return res.status(404).json({ error: "That isn't your repo." });
  const sd = sitesDomain();
  res.json({ domain: status(db.prepare("SELECT * FROM domains WHERE repo_id = ?").get(r.id), r),
    subdomainUrl: sd ? `https://${r.owner}.${sd}/${encodeURIComponent(r.name)}/` : null });
});

domainsRouter.put("/:owner/:name", requireUser, rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
  const r = findRepo(req.params.owner, req.params.name, req.user);
  if (!r?.mine) return res.status(404).json({ error: "That isn't your repo." });
  const domain = String(req.body?.domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  if (!DOMAIN_RE.test(domain)) return res.status(400).json({ error: "That isn't a domain. Type it like mygame.com." });
  const sd = sitesDomain();
  if (domain === ownHost() || (sd && (domain === sd || domain.endsWith(`.${sd}`)))) return res.status(400).json({ error: "That address belongs to Forgehub." });
  const taken = db.prepare("SELECT repo_id FROM domains WHERE domain = ?").get(domain);
  if (taken && taken.repo_id !== r.id) return res.status(409).json({ error: "Another repo is using that domain." });
  db.prepare("DELETE FROM domains WHERE repo_id = ?").run(r.id);
  db.prepare("INSERT INTO domains (domain, repo_id, token, created_at) VALUES (?, ?, ?, ?)").run(domain, r.id, `forgehub-verify=${randomBytes(12).toString("hex")}`, now());
  res.json({ domain: status(db.prepare("SELECT * FROM domains WHERE repo_id = ?").get(r.id), r) });
});

domainsRouter.post("/:owner/:name/verify", requireUser, rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  const r = findRepo(req.params.owner, req.params.name, req.user);
  const row = r?.mine && db.prepare("SELECT * FROM domains WHERE repo_id = ?").get(r.id);
  if (!row) return res.status(404).json({ error: "Add a domain first." });
  let records = [];
  try { records = (await lookupTxt(`_forgehub.${row.domain}`)).map(parts => parts.join("")); } catch {}
  if (!records.includes(row.token)) {
    return res.status(409).json({ error: "We couldn't find the TXT record yet. DNS changes can take up to an hour; check the name and value, then try again." });
  }
  db.prepare("UPDATE domains SET verified_at = ? WHERE domain = ?").run(now(), row.domain);
  res.json({ domain: status(db.prepare("SELECT * FROM domains WHERE repo_id = ?").get(r.id), r) });
});

domainsRouter.delete("/:owner/:name", requireUser, (req, res) => {
  const r = findRepo(req.params.owner, req.params.name, req.user);
  if (!r?.mine) return res.status(404).json({ error: "That isn't your repo." });
  db.prepare("DELETE FROM domains WHERE repo_id = ?").run(r.id);
  res.json({ ok: true });
});
