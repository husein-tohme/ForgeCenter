import { $, api, esc, money, onUser, openSignIn } from "./common.js";
onUser(async user => {
  if (!user) { $("items").innerHTML = `<div class="empty"><p>Sign in to see what you've bought.</p><button class="btn btn-primary" id="si">Sign in</button></div>`; $("si").onclick = () => openSignIn(); return; }
  const r = await api("/api/store/library");
  const items = r.data.items ?? [];
  if (new URLSearchParams(location.search).get("paid")) document.querySelector(".page-head").insertAdjacentHTML("beforeend", `<p class="pill pill-accent">Thanks! It can take a few seconds for a new purchase to appear. Reload if it isn't here yet.</p>`);
  $("items").innerHTML = items.length ? `<div class="grid">${items.map(i => `<div class="card"><h3>${esc(i.title)}</h3>
    <div class="meta"><span>${money(i.amountCents)}</span><span>from @${esc(i.seller ?? "deleted")}</span><span>${new Date(i.paidAt).toLocaleDateString()}</span></div>
    ${i.download ? `<a class="btn btn-primary btn-small" href="${esc(i.download)}">Download</a>` : `<span class="pill">Donation</span>`}</div>`).join("")}</div>`
    : `<div class="empty">Nothing here yet. <a href="/store">Browse the store</a>.</div>`;
});
