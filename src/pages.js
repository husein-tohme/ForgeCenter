// Serves the HTML pages with the site's address filled in (link previews need full
// URLs), plus robots.txt, sitemap.xml and the not-found page.
import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { creatorPreview } from "./creators.js";

const PUBLIC = resolve("public");
// Pages search engines may list. Account and owner pages stay out.
const LISTED = ["/", "/textures", "/modpacks", "/plugins", "/games", "/creators", "/roblox", "/ai-maker", "/site-maker", "/developers", "/donate", "/orbs", "/rules", "/privacy", "/terms", "/subprocessors", "/dpa", "/support"];

const cache = new Map();
const baseUrl = req => (process.env.BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");

function render(file, req, canonicalPath) {
  let html = cache.get(file);
  if (html === undefined) {
    html = readFileSync(file, "utf8");
    if (process.env.NODE_ENV === "production") cache.set(file, html);
  }
  const base = baseUrl(req);
  html = html.replaceAll("%BASE_URL%", base).replaceAll("%PAGE_URL%", base + canonicalPath);
  return html.includes('name="robots" content="noindex"') ? html : html.replace("</head>", `${structuredData(html, base, canonicalPath)}\n</head>`);
}

// Structured data for search engines: who ForgeCenter is on the home page, and a
// breadcrumb (Home > page) everywhere else. "<" is escaped so text can't end the script.
function structuredData(html, base, path) {
  const json = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
  if (path === "/") {
    return json({
      "@context": "https://schema.org", "@graph": [
        { "@type": "Organization", "@id": `${base}/#org`, name: "ForgeCenter", url: `${base}/`, logo: `${base}/brand/forgecenter-avatar.png` },
        { "@type": "WebSite", name: "ForgeCenter", url: `${base}/`, publisher: { "@id": `${base}/#org` } },
      ],
    });
  }
  const title = (html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "").replace(/ · ForgeCenter$/, "").trim();
  if (!title || title.startsWith("%")) return "";
  return json({
    "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "ForgeCenter", item: `${base}/` },
      { "@type": "ListItem", position: 2, name: title, item: `${base}${path}` },
    ],
  });
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
