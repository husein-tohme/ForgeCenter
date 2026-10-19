// Repo and product cards, shared by several pages.
import { esc, ago, money } from "./common.js";
export const repoCard = r => `<a class="card" href="/${esc(r.owner)}/${encodeURIComponent(r.name)}">
  <h3>${esc(r.owner)}/<b>${esc(r.name)}</b></h3>${r.description ? `<p>${esc(r.description)}</p>` : ""}
  <div class="meta">${r.private ? `<span class="pill">Private</span>` : ""}<span>★ ${r.stars}</span><span>Updated ${ago(r.updatedAt)}</span></div></a>`;
export const productCard = p => `<a class="card" href="/store/${p.id}">
  <h3>${esc(p.title)}</h3>${p.description ? `<p>${esc(p.description.slice(0, 140))}</p>` : ""}
  <div class="meta"><span class="price">${money(p.priceCents)}</span><span>by @${esc(p.seller)}</span></div></a>`;
