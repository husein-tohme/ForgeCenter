import { $, api, esc, money, onUser, toast } from "./common.js";
import { productCard } from "./cards.js";
const form = $("search");
async function load() {
  const r = await api(`/api/store/products?q=${encodeURIComponent(form.q.value)}`);
  const p = r.data.products ?? [];
  $("products").innerHTML = p.length ? p.map(productCard).join("") : `<div class="empty">Nothing for sale yet${form.q.value ? " that matches" : ""}.</div>`;
}
form.addEventListener("submit", e => { e.preventDefault(); load(); });
load();

// Sellers: connect Stripe, add items, see sales.
onUser(async user => {
  if (!user?.username) return;
  const [m, repos] = await Promise.all([api("/api/store/mine"), api(`/api/repos/user/${encodeURIComponent(user.username)}`)]);
  if (!m.ok) return;
  const s = m.data, box = $("seller");
  box.hidden = false;
  const status = !s.payments ? `<p class="muted">Payments open soon. You can get your items ready now: put the files in a repo.</p>`
    : !s.adult ? `<p class="muted">Selling needs an adult account, because Stripe only pays out to people 18 and over. You can still buy and take part in everything else.</p>`
    : !s.canSell ? `<p class="muted">Connect Stripe to get paid. Buyers pay you directly; Forgehub keeps ${s.feePercent}% per sale.</p><button class="btn btn-primary" id="connect">${s.connected ? "Finish Stripe setup" : "Connect Stripe"}</button>`
    : `<p class="pill pill-accent">Stripe connected. You can sell.</p>`;
  box.innerHTML = `<h2>Sell your work</h2>${status}
    <form class="form" id="add" style="margin-top:14px"><h3>Add an item</h3>
      <label>Title<input name="title" required maxlength="80" placeholder="Pixel sword texture pack"></label>
      <label>Description<textarea name="description" maxlength="2000" placeholder="What's included, which versions it works with, the licence…"></textarea></label>
      <div class="row"><label style="flex:1">Price (USD)<input name="price" type="number" min="0.5" max="1000" step="0.01" required value="2.99"></label>
      <label style="flex:2">Files from repo<select name="repo" required>${(repos.data.repos ?? []).map(r => `<option>${esc(r.name)}</option>`).join("") || `<option value="">Make a repo first</option>`}</select></label></div>
      <button class="btn btn-primary">Add item</button></form>
    ${s.products.length ? `<h3 style="margin-top:20px">Your items</h3>${s.products.map(p => `<div class="row spread" style="padding:8px 0;border-top:1px solid var(--border)">
      <a href="/store/${p.id}">${esc(p.title)}</a><span>${money(p.priceCents)}</span><button class="btn btn-small" data-toggle="${p.id}" data-active="${p.active}">${p.active ? "Stop selling" : "Sell again"}</button></div>`).join("")}` : ""}
    ${s.sales.length ? `<h3 style="margin-top:20px">Recent sales</h3>${s.sales.map(x => `<div class="row spread small"><span>${esc(x.title)}</span><span>${money(x.amountCents)} · ${new Date(x.paidAt).toLocaleDateString()}</span></div>`).join("")}` : ""}`;
  $("connect")?.addEventListener("click", async () => { const r = await api("/api/store/connect", { method: "POST" }); r.ok ? location.assign(r.data.url) : toast(r.data.error); });
  $("add").onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const r = await api("/api/store/products", { method: "POST", body: { title: f.elements.title.value, description: f.elements.description.value, priceCents: Math.round(Number(f.elements.price.value) * 100), repo: f.elements.repo.value } });
    if (!r.ok) return toast(r.data.error);
    location.assign(`/store/${r.data.product.id}`);
  };
  box.querySelectorAll("[data-toggle]").forEach(b => b.onclick = async () => {
    await api(`/api/store/products/${b.dataset.toggle}`, { method: "PATCH", body: { active: b.dataset.active !== "true" } });
    location.reload();
  });
});
