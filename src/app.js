// Builds the Express app. server.js starts it; tests call createApp() directly.
import express from "express";
import helmet from "helmet";
import compression from "compression";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "./db.js";
import { loadUser, meRouter, authRouter } from "./auth.js";
import { oauthRouter, enabledOAuthProviders } from "./oauth.js";
import { reposRouter, filesRouter, findRepo } from "./repos.js";
import { storeRouter, downloadRouter, stripeWebhook, stripe } from "./store.js";
import { aiRouter } from "./forgeai.js";
import { reportsRouter, adminRouter } from "./reports.js";
import { messagesRouter } from "./messages.js";
import { USERNAME_RE, RESERVED } from "./auth.js";

const PUBLIC = "public";
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const base = req => (process.env.BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");

// Pages are plain HTML files with %TITLE%, %DESCRIPTION% and %URL% filled in here, so
// every page has its own title, description and canonical link for search engines.
const cache = new Map();
function page(name, req, { title, description, path, noindex = false }) {
  let html = cache.get(name) ?? readFileSync(join(PUBLIC, `${name}.html`), "utf8");
  if (process.env.NODE_ENV === "production") cache.set(name, html);
  return html.replaceAll("%TITLE%", () => esc(title)).replaceAll("%DESCRIPTION%", () => esc(description))
    .replaceAll("%URL%", () => esc(base(req) + path)).replaceAll("%BASE%", () => esc(base(req)))
    .replace("<!--ROBOTS-->", noindex ? '<meta name="robots" content="noindex">' : "");
}

const PAGES = {
  "/": ["index", "Forgehub: code, websites and a store for digital things", "Host your code in repos, run websites from them, and sell your digital work. Free to start, with Forge AI to help."],
  "/explore": ["explore", "Explore repos · Forgehub", "Find public code, games, mods, websites and tools made by Forgehub creators."],
  "/store": ["store", "Store · Forgehub", "Buy and sell digital things: code, game files, mods, art and templates. Pay with card, Apple Pay, Google Pay and more."],
  "/library": ["library", "Your library · Forgehub", "Everything you've bought on Forgehub.", true],
  "/ai": ["ai", "Forge AI · Forgehub", "Ask Forge AI about coding and using Forgehub. Free."],
  "/inbox": ["inbox", "Inbox · Forgehub", "Your messages on Forgehub.", true],
  "/new": ["new", "New repo · Forgehub", "Make a new repo on Forgehub.", true],
  "/settings": ["settings", "Settings · Forgehub", "Your Forgehub account settings.", true],
  "/admin": ["admin", "Owner panel · Forgehub", "Forgehub moderation.", true],
  "/privacy": ["privacy", "Privacy policy · Forgehub", "What Forgehub stores, why, and how to download or delete it."],
  "/terms": ["terms", "Terms of service · Forgehub", "The rules for using, buying and selling on Forgehub."],
};
const LISTED = ["/", "/explore", "/store", "/ai", "/privacy", "/terms"];

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(compression());
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      "default-src": ["'self'"], "script-src": ["'self'"], "style-src": ["'self'", "https://fonts.googleapis.com"], "style-src-attr": ["'unsafe-inline'"],
      "font-src": ["'self'", "https://fonts.gstatic.com"], "img-src": ["'self'", "data:", "blob:", "https:"],
      "frame-src": ["'self'"], "connect-src": ["'self'"], "form-action": ["'self'"],
    } },
    crossOriginEmbedderPolicy: false,
  }));

  app.post("/api/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), stripeWebhook);
  app.use(express.json({ limit: "100kb" }));
  app.use(loadUser);

  // CSRF guard: state-changing API calls must come from this site as JSON. The one
  // exception is file uploads (raw bytes), which must still carry this site's Origin.
  const siteHost = (() => { try { return new URL(process.env.BASE_URL).host; } catch { return null; } })();
  app.use("/api", (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method) || req.path === "/stripe/webhook") return next();
    const origin = req.get("origin");
    let same = true;
    if (origin) { try { const h = new URL(origin).host; same = h === req.get("host") || h === siteHost; } catch { same = false; } }
    if (!same) return res.status(403).json({ error: "Cross-site request blocked." });
    const upload = req.method === "PUT" && /^\/repos\/[^/]+\/[^/]+\/file$/.test(req.path) && req.is("application/octet-stream");
    if (upload && !origin) return res.status(403).json({ error: "Uploads must come from the Forgehub site." });
    if (!upload && !req.is("application/json")) return res.status(415).json({ error: "Send requests as JSON." });
    next();
  });

  app.get("/api/config", (_req, res) => res.json({ signIn: enabledOAuthProviders(), payments: !!stripe(),
    devLogin: process.env.DEV_LOGIN === "1" && process.env.NODE_ENV !== "production" }));
  app.get("/healthz", (_req, res) => { db.prepare("SELECT 1").get(); res.json({ ok: true }); });
  app.use("/api/auth", authRouter, oauthRouter);
  app.use("/api/me", meRouter);
  app.use("/api/repos", reposRouter);
  app.use("/api/store", storeRouter);
  app.use("/api/ai", aiRouter);
  app.use("/api/messages", messagesRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

  app.use(filesRouter, downloadRouter);

  app.get("/robots.txt", (req, res) => res.type("text/plain").send(
    `User-agent: *\nDisallow: /api/\nDisallow: /settings\nDisallow: /admin\nDisallow: /library\nDisallow: /p/\nDisallow: /raw/\nDisallow: /zip/\n\nSitemap: ${base(req)}/sitemap.xml\n`));
  app.get("/sitemap.xml", (req, res) => {
    const repos = db.prepare(`SELECT u.username, r.name, r.updated_at FROM repos r JOIN users u ON u.id = r.user_id
      WHERE r.private = 0 AND u.suspended_at IS NULL ORDER BY r.updated_at DESC LIMIT 5000`).all();
    const urls = [...LISTED.map(p => `<url><loc>${base(req)}${p}</loc></url>`),
      ...repos.map(r => `<url><loc>${esc(`${base(req)}/${r.username}/${encodeURIComponent(r.name)}`)}</loc><lastmod>${r.updated_at.slice(0, 10)}</lastmod></url>`)];
    res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`);
  });

  app.use(express.static(PUBLIC, { index: false, setHeaders(res, p) {
    res.setHeader("Cache-Control", /\.(png|svg|ico|webp|jpg|woff2?)$/.test(p) ? "public, max-age=604800" : "no-cache");
  } }));

  for (const [path, [name, title, description, noindex]] of Object.entries(PAGES)) {
    app.get(path, (req, res) => res.type("html").send(page(name, req, { title, description, path, noindex })));
  }
  app.get("/store/:id(\\d+)", (req, res, next) => {
    const p = db.prepare("SELECT p.title, p.description FROM products p JOIN users u ON u.id = p.user_id WHERE p.id = ? AND p.active = 1 AND u.suspended_at IS NULL").get(Number(req.params.id));
    if (!p) return next();
    res.type("html").send(page("product", req, { title: `${p.title} · Forgehub Store`, description: p.description.slice(0, 160) || p.title, path: req.path }));
  });
  // GitHub-style addresses: /<username> and /<username>/<repo>.
  app.get("/:username", (req, res, next) => {
    const name = req.params.username.toLowerCase();
    if (!USERNAME_RE.test(name) || RESERVED.has(name)) return next();
    const u = db.prepare("SELECT username, name, bio, suspended_at FROM users WHERE username = ?").get(name);
    if (!u || u.suspended_at) return next();
    res.type("html").send(page("profile", req, { title: `${u.name} (@${u.username}) · Forgehub`, description: u.bio || `${u.name}'s repos and store on Forgehub.`, path: `/${u.username}` }));
  });
  app.get("/:username/:repo", (req, res, next) => {
    const r = findRepo(req.params.username, req.params.repo, req.user);
    if (!r) return next();
    res.type("html").send(page("repo", req, { title: `${r.owner}/${r.name} · Forgehub`, description: r.description || `${r.name} by @${r.owner} on Forgehub.`,
      path: `/${r.owner}/${encodeURIComponent(r.name)}`, noindex: !!r.private }));
  });

  app.use((req, res) => res.status(404).type("html").send(page("404", req, { title: "Page not found · Forgehub", description: "This page doesn't exist.", path: req.path, noindex: true })));
  app.use((err, req, res, _next) => {
    if (err.type === "entity.too.large") return res.status(413).json({ error: "That file is too big. Files can be up to 10 MB." });
    console.error(err);
    res.status(500).json({ error: "Something went wrong on our side. Try again in a minute." });
  });
  return app;
}
