// Serves the HTML pages with the site's address filled in (link previews need full
// URLs), plus robots.txt, sitemap.xml and the not-found page.
import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { creatorPreview } from "./creators.js";

const PUBLIC = resolve("public");
// Pages search engines may list. Account and owner pages stay out.
const LISTED = ["/", "/textures", "/modpacks", "/plugins", "/games", "/creators", "/privacy", "/terms"];

const cache = new Map();
const baseUrl = req => (process.env.BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");

function render(file, req, canonicalPath) {
  let html = cache.get(file);
  if (html === undefined) {
    html = readFileSync(file, "utf8");
    if (process.env.NODE_ENV === "production") cache.set(file, html);
  }
  const base = baseUrl(req);
  return html.replaceAll("%BASE_URL%", base).replaceAll("%PAGE_URL%", base + canonicalPath);
}

export const pagesRouter = express.Router();

pagesRouter.get("/robots.txt", (req, res) => {
  res.type("text/plain").send(`User-agent: *\nDisallow: /api/\nDisallow: /account\nDisallow: /admin\n\nSitemap: ${baseUrl(req)}/sitemap.xml\n`);
});

pagesRouter.get("/sitemap.xml", (req, res) => {
  const urls = LISTED.map(p => `  <url><loc>${baseUrl(req)}${p}</loc></url>`).join("\n");
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
});

// A creator's public page. Hidden and unknown handles get the not-found page.
pagesRouter.get("/c/:handle", (req, res, next) => {
  const preview = creatorPreview(req.params.handle, req.user);
  if (!preview) return next();
  // Replacer functions, so a "$&" or "$`" in a name or bio goes in as typed instead of
  // being read as a replacement pattern that pastes in other parts of the page.
  res.type("html").send(render(join(PUBLIC, "creator.html"), req, `/c/${preview.handle}`)
    .replaceAll("%CREATOR_TITLE%", () => preview.title).replaceAll("%CREATOR_DESCRIPTION%", () => preview.description));
});

// "/", "/textures" and "/textures.html" all serve public/<name>.html. The pattern
// allows only plain names, so nothing outside public/ can be reached.
pagesRouter.get(/^\/([a-z0-9-]*)(\.html)?$/, (req, res, next) => {
  const name = req.params[0] || "index";
  const file = join(PUBLIC, `${name}.html`);
  if (name === "404" || name === "creator" || !existsSync(file)) return next();
  res.type("html").send(render(file, req, name === "index" ? "/" : `/${name}`));
});

export function notFound(req, res) {
  res.status(404).type("html").send(render(join(PUBLIC, "404.html"), req, req.path));
}
