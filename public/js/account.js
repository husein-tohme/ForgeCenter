import { renderService } from "./service.js";
import { $, api, esc, icon, money, date, toast, onUser, openSignIn, signOut, pill, renderSignInOptions, STATUS, SUB_STATUS, PRODUCT_ICON, PROVIDER_NAMES } from "./common.js";

const params = new URLSearchParams(location.search);
const focusOrder = Number(params.get("order")) || null;
if (params.get("paid") === "1") toast("Payment received. Your order will update in a moment.");

$("signin-here").addEventListener("click", () => openSignIn());
$("signout").addEventListener("click", async () => { await signOut(); });
$("billing").addEventListener("click", async e => {
  e.target.disabled = true;
  const r = await api("/api/billing-portal", { method: "POST" });
  e.target.disabled = false;
  if (r.data.url) location.href = r.data.url; else toast(r.data.error);
});
$("delete").addEventListener("click", async () => {
  if (!confirm("Delete your ForgeCenter account? This can't be undone.")) return;
  const r = await api("/api/me", { method: "DELETE" });
  if (!r.ok) return toast(r.data.error);
  location.href = "/";
});

onUser(user => {
  $("signed-out").hidden = !!user;
  $("account").hidden = !user;
  if (!user) return;
  $("p-name").textContent = user.name;
  $("p-email").textContent = [user.email, user.phone].filter(Boolean).join(", ");
  if (user.picture) { $("avatar").src = user.picture; $("avatar").hidden = false; }
  $("billing").hidden = !user.hasBilling;
  loadIdentities(); loadOrders(); loadShowcase(); loadMods();
});

// ---------- Name ----------
$("rename-open").addEventListener("click", () => {
  $("rename-input").value = $("p-name").textContent;
  $("rename-form").hidden = false; $("rename-open").hidden = true; $("rename-input").focus();
});
$("rename-form").addEventListener("submit", async e => {
  e.preventDefault();
  const r = await api("/api/me", { method: "PATCH", body: { name: $("rename-input").value } });
  if (!r.ok) return toast(r.data.error);
  $("p-name").textContent = r.data.user.name;
  $("rename-form").hidden = true; $("rename-open").hidden = false;
  toast("Name saved.");
});

// ---------- Sign-in methods ----------
async function loadIdentities() {
  const r = await api("/api/me/identities");
  const ids = r.data.identities ?? [];
  $("identities").innerHTML = ids.map(i => `<li class="panel identity">
      <span><strong>${esc(PROVIDER_NAMES[i.provider] ?? i.provider)}</strong> <span class="small">${esc(i.display ?? "")}</span></span>
      ${ids.length > 1 ? `<button class="btn btn-small" type="button" data-unlink="${esc(i.provider)}">Remove</button>` : ""}
    </li>`).join("");
  $("identities").querySelectorAll("[data-unlink]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm(`Remove ${PROVIDER_NAMES[b.dataset.unlink]} sign-in from your account?`)) return;
    const res = await api(`/api/me/identities/${b.dataset.unlink}`, { method: "DELETE" });
    if (!res.ok) return toast(res.data.error);
    toast(`${PROVIDER_NAMES[b.dataset.unlink]} sign-in removed.`);
    loadIdentities();
  }));
  renderSignInOptions($("connect-options"), { link: true, exclude: ids.map(i => i.provider) });
}

// ---------- Orders ----------
// Servers and bots are set up automatically, so their orders explain that instead.
const SERVICE_HELP = {
  minecraft: { paid: "Payment received. Your server is being set up below.", in_progress: "Your server is being set up below.", delivered: "Your server is ready." },
  discord_bot: { paid: "Payment received. Switch on your bot below. Use the brief and messages for custom features you'd like.", in_progress: "Your bot is being customised. Updates will appear in the messages below.", delivered: "Your bot is set up." },
};
const amountText = o => [o.amount ? money(o.amount) : "", o.monthly ? `${money(o.monthly)} a month` : ""].filter(Boolean).join(" + ");

async function loadOrders() {
  const r = await api("/api/orders");
  const orders = r.data.orders ?? [];
  if (!orders.length) {
    $("orders").innerHTML = `<div class="panel empty"><span class="empty-icon">${icon("emerald")}</span>
      <div><p>You haven't ordered anything yet.</p><a class="btn btn-buy" href="/#shop">See prices</a></div></div>`;
    return;
  }
  $("orders").innerHTML = orders.map(o => `
    <details class="panel order" data-id="${o.id}">
      <summary>
        <span class="slot">${icon(PRODUCT_ICON[o.product] ?? "emerald")}</span>
        <span class="order-main"><strong>${esc(o.name)}</strong><span class="small">Order ${o.id}, ${date(o.createdAt)}, ${amountText(o)}</span></span>
        ${pill(o.status)}
      </summary>
      <div class="order-body"><p class="hint">Loading…</p></div>
    </details>`).join("");
  document.querySelectorAll("details.order").forEach(d => {
    d.addEventListener("toggle", () => { if (d.open && !d.dataset.loaded) loadOrder(d); });
    if (Number(d.dataset.id) === focusOrder) { d.open = true; d.scrollIntoView({ block: "start" }); }
  });
}

function thread(messages) {
  if (!messages.length) return `<p class="hint">No messages yet. Ask anything about your order here.</p>`;
  return messages.map(m => `<div class="msg-row ${m.fromOwner ? "from-owner" : "from-me"}">
    <b>${m.fromOwner ? "ForgeCenter" : "You"}</b><span class="small">${date(m.createdAt)}</span><p>${esc(m.body)}</p></div>`).join("");
}

async function loadOrder(d) {
  const r = await api(`/api/orders/${d.dataset.id}`);
  const body = d.querySelector(".order-body");
  if (!r.ok) { body.innerHTML = `<p class="error">${esc(r.data.error)}</p>`; return; }
  const o = r.data.order;
  d.dataset.loaded = "1";
  d.querySelector(".pill").outerHTML = pill(o.status);
  const locked = ["delivered", "canceled"].includes(o.status);
  const canWrite = !["awaiting_payment", "expired", "payment_failed"].includes(o.status);
  const kind = o.service?.kind;
  const help = SERVICE_HELP[kind]?.[o.status] ?? STATUS[o.status]?.help ?? "";
  const showBrief = canWrite && kind !== "minecraft";
  body.innerHTML = `
    <p>${esc(help)}</p>
    ${o.monthly && o.subscriptionStatus ? `<p class="small">${esc(SUB_STATUS[o.subscriptionStatus] ?? "")}</p>` : ""}
    ${o.deliverableUrl ? `<p><a class="btn btn-buy" href="${esc(o.deliverableUrl)}" target="_blank" rel="noopener">Open your project</a></p>` : ""}
    <div class="service-box"></div>
    ${showBrief ? `
    <form class="brief-form">
      <label>Project brief<textarea name="brief" rows="5" maxlength="5000" ${locked ? "disabled" : ""}
        placeholder="Describe what you want: features, colours, examples you like, deadlines.">${esc(o.brief)}</textarea></label>
      ${locked ? "" : `<button class="btn" type="submit">Save brief</button>`}
    </form>` : ""}
    ${canWrite ? `
    <h3>Messages</h3>
    <div class="thread">${thread(o.messages)}</div>
    <form class="msg-form">
      <label class="sr-only" for="msg-${o.id}">Message</label>
      <textarea id="msg-${o.id}" name="body" rows="2" maxlength="4000" placeholder="Write a message"></textarea>
      <button class="btn btn-buy" type="submit">Send message</button>
    </form>` : ""}`;

  renderService(body.querySelector(".service-box"), o.service, { reload: () => loadOrder(d) });

  body.querySelector(".brief-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const res = await api(`/api/orders/${o.id}`, { method: "PATCH", body: { brief: e.target.brief.value } });
    toast(res.ok ? "Brief saved." : res.data.error);
  });
  body.querySelector(".msg-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const text = e.target.body.value.trim();
    if (!text) return;
    const res = await api(`/api/orders/${o.id}/messages`, { method: "POST", body: { body: text } });
    if (!res.ok) return toast(res.data.error);
    e.target.body.value = "";
    body.querySelector(".thread").innerHTML = thread(res.data.messages);
    toast("Message sent.");
  });
}

// ---------- Showcase ----------
async function loadShowcase() {
  const r = await api("/api/showcase/mine");
  const { listings = [], credits = 0 } = r.data;
  const labels = { pending: "Waiting for approval", approved: "Live", hidden: "Hidden" };
  const tones = { pending: "wait", approved: "done", hidden: "muted" };
  let html = listings.map(l => `<div class="panel listing-row">
      <div><strong>${esc(l.title)}</strong> <span class="pill pill-${tones[l.status]}">${labels[l.status]}</span>
      <p class="small"><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.url)}</a></p></div>
      <button class="btn btn-small" type="button" data-remove="${l.id}">Remove</button></div>`).join("");
  if (credits > 0) {
    html += `<form class="panel form" id="listing-form">
      <p>You have ${credits} unused showcase slot${credits > 1 ? "s" : ""}. Listings go live after a quick review.</p>
      <label>Title<input name="title" required maxlength="80" placeholder="Skyblock Server"></label>
      <label>Link<input name="url" type="url" required maxlength="300" placeholder="https://"></label>
      <label>Short description<input name="description" maxlength="300" placeholder="What makes it worth a visit?"></label>
      <button class="btn btn-buy" type="submit">Submit listing</button></form>`;
  } else if (!listings.length) {
    html = `<p class="hint">Buy a showcase slot to list a website or server on the homepage.</p>
      <button class="btn" type="button" data-buy="showcase">Buy a showcase slot for $10</button>`;
  }
  $("showcase").innerHTML = html;
  $("listing-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const res = await api("/api/showcase", { method: "POST", body: f });
    toast(res.ok ? "Listing submitted for review." : res.data.error);
    if (res.ok) loadShowcase();
  });
  $("showcase").querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Remove this listing? The slot can't be reused.")) return;
    const res = await api(`/api/showcase/${b.dataset.remove}`, { method: "DELETE" });
    if (res.ok) loadShowcase(); else toast(res.data.error);
  }));
}

// ---------- Saved creations ----------
const KINDS = {
  mod: { icon: "pickaxe", label: "Mod", again: "/#forge" },
  texturepack: { icon: "painting", label: "Texture pack", again: "/textures" },
  modpack: { icon: "chest", label: "Modpack", again: "/modpacks" },
  plugin: { icon: "anvil", label: "Server plugin", again: "/plugins" },
};
async function loadMods() {
  const r = await api("/api/creations");
  const items = r.data.creations ?? [];
  $("mods").innerHTML = items.length
    ? `<ul class="mod-list">${items.map(m => {
        const k = KINDS[m.kind] ?? KINDS.mod;
        return `<li><span class="mod-icon">${icon(k.icon)}</span><strong>${esc(m.name)}</strong>
          <span class="small">${k.label}, ${date(m.createdAt)}</span>${m.modrinthUrl ? ` <a href="${esc(m.modrinthUrl)}" target="_blank" rel="noopener">View on Modrinth</a>` : ""}</li>`;
      }).join("")}</ul>`
    : `<p class="hint">Mods, plugins, texture packs and modpacks you make while signed in show up here.</p><a class="btn" href="/#tools">Open the free tools</a>`;
}
