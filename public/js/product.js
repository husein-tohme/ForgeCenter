import { $, api, esc, money, onUser, openSignIn, openReport, getUser, toast } from "./common.js";
const id = location.pathname.split("/").pop();
onUser(async () => {
  const r = await api(`/api/store/products/${id}`);
  const box = $("product");
  if (!r.ok) { box.innerHTML = `<div class="empty">${esc(r.data.error)}</div>`; return; }
  const p = r.data.product;
  box.innerHTML = `<p class="small"><a href="/store">Store</a> / <a href="/${esc(p.seller)}">@${esc(p.seller)}</a></p>
    <h1>${esc(p.title)}</h1><p class="price">${money(p.priceCents)}</p>
    <div style="white-space:pre-wrap" class="muted">${esc(p.description || "No description.")}</div>
    <div class="row" style="margin-top:20px">
      ${r.data.owned ? `<a class="btn btn-primary" href="/library">In your library</a>` : r.data.mine ? `<span class="pill">Your item</span>`
        : `<button class="btn btn-primary" id="buy" ${r.data.payments ? "" : "disabled"}>${r.data.payments ? `Buy for ${money(p.priceCents)}` : "Payments open soon"}</button>`}
      <button class="btn" id="report">Report</button></div>
    <p class="small muted" style="margin-top:14px">Digital download. Pay with card, Apple Pay, Google Pay or other methods Stripe offers in your country. You'll get the files in your library.</p>`;
  $("report").onclick = () => openReport("product", String(p.id));
  $("buy")?.addEventListener("click", async () => {
    if (!getUser()) return openSignIn();
    const x = await api(`/api/store/products/${p.id}/checkout`, { method: "POST" });
    x.ok ? location.assign(x.data.url) : toast(x.data.error);
  });
});
