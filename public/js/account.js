import { renderService } from "./service.js";
import { $, api, esc, icon, registerIcons, openAgeConfirm, money, cash, orbs, date, toast, getUser, onUser, adultPerks, openSignIn, signOut, pill, renderSignInOptions, refreshUser, stack, STATUS, SUB_STATUS, PRODUCT_ICON, PROVIDER_NAMES } from "./common.js";

const params = new URLSearchParams(location.search);
const focusOrder = Number(params.get("order")) || null;
const ageCheck = Number(params.get("age_check")) || null;
const toppedUp = params.has("topup");
if (params.get("paid") === "1") toast("Payment received. Your order will update in a moment.");
if (params.get("paid") === "wallet") toast("Paid with orbs. Your order is below.");
if (params.get("topup")) toast("Thanks! Your orbs will show up in a moment.");
// Read once; drop them so a reload doesn't repeat the messages.
for (const k of ["paid", "topup", "age_check"]) params.delete(k);
history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "") + location.hash);

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
  // Load once the account has answered the birthday question, and not again when the
  // same account is refreshed (for example after a top-up).
  if (!user.ageGroup || loadedFor === user.id) return;
  loadedFor = user.id;
  loadIdentities(); loadOrders(); loadWallet(); loadAge(); loadShowcase(); loadMods(); loadCreator();
});
let loadedFor = null;

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
// Game launches are managed on My games, so their orders point there instead of asking for a brief.
const LAUNCH_HELP = {
  awaiting_payment: "Checkout isn't finished. Press Launch on your game in My games to try again.",
  payment_failed: "The payment didn't go through. Press Launch on your game in My games to try again.",
  expired: "Checkout closed before payment. Launch your game from My games whenever you're ready.",
};
const launchHelp = o => LAUNCH_HELP[o.status]
  ?? (o.subscriptionStatus === "active" ? "Your game is on the ForgeCenter games page. Edit it, cancel or switch it back on in My games."
    : o.subscriptionStatus === "past_due" ? "Your last payment failed, so your game is off the games page. Update your card in Manage billing to bring it back."
    : "This launch has ended. You can launch your game again from My games.");
const amountText = o => o.paidWith === "wallet" ? `paid with ${orbs(o.amount)}`
  : [o.amount ? money(o.amount) : "", o.monthly ? `${money(o.monthly)} a month` : ""].filter(Boolean).join(" + ");

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
  const launch = o.product === "launch";
  const help = launch ? launchHelp(o) : SERVICE_HELP[kind]?.[o.status] ?? STATUS[o.status]?.help ?? "";
  const showBrief = canWrite && kind !== "minecraft" && !launch;
  body.innerHTML = `
    <p>${esc(help)}</p>
    ${launch ? `<p><a class="btn btn-buy" href="/my-games">Open My games</a></p>` : ""}
    ${o.monthly && o.subscriptionStatus && !launch ? `<p class="small">${esc(SUB_STATUS[o.subscriptionStatus] ?? "")}</p>` : ""}
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

// ---------- Orbs ----------
// Amounts are in cents, which are orbs (1 orb = 1 cent).
const ENTRY_TEXT = {
  topup: () => "Bought orbs",
  purchase: e => `Spent on ${e.product ?? "an order"}${e.orderId ? ` (order ${e.orderId})` : ""}`,
  refund: e => `Orbs back for order ${e.orderId}`,
  credit: e => `Orbs from ForgeCenter: ${e.note}`,
  topup_refund: () => "Orb pack refunded to your card",
  dispute: e => e.note || "Card dispute",
  api: e => e.note || "Developer API call",
  reward: e => `Creator reward: ${e.note}`,
  ai: e => e.note || "AI messages after your free ones",
  ai_refund: e => e.note || "Orbs back for AI messages",
};
const PACKS = [500, 1000, 2500, 5000, 10000];

async function loadWallet(retry = toppedUp) {
  const r = await api("/api/wallet");
  if (!r.ok) { $("wallet-panel").innerHTML = `<p class="error">${esc(r.data.error)}</p>`; return; }
  const { balance, entries, pending, limits, available, aiOrbs, orbsPerAiUnit } = r.data;
  const pendingOrbs = pending.reduce((n, t) => n + t.amount, 0);
  $("wallet-panel").innerHTML = `
    <div class="wallet-balance">${stack(balance, { big: true })}
      <span><strong class="num">${esc(orbs(balance))}</strong><br><span class="small">Worth ${cash(balance)}</span></span></div>
    <div class="wallet-add">
      <h3>Buy orbs</h3>
      ${available ? `<div class="orb-packs">
        ${PACKS.map(a => `<button class="btn btn-buy orb-pack" type="button" data-topup="${a}"><span class="num">${a.toLocaleString("en-US")}</span> orbs<span class="pack-price">${money(a)}</span></button>`).join("")}
      </div>
      <form class="custom orb-custom" id="topup-custom">
        <label>Other amount, in orbs<input name="orbs" type="number" inputmode="numeric" min="${limits.minTopup}" max="${limits.maxTopup}" step="100" placeholder="${limits.minTopup}" required></label>
        <button class="btn" type="submit">Buy</button>
        <span class="small" id="custom-price" aria-live="polite"></span>
      </form>
      <p class="small">${orbs(limits.minTopup)} to ${orbs(limits.maxTopup)} at a time, in hundreds, and up to ${orbs(limits.maxBalance)} in your account. Paid by card through Stripe. No bonus orbs, no tricks: 1 orb is 1 cent.</p>`
        : `<p class="hint">Buying orbs isn't available yet.</p>`}
      ${pendingOrbs ? `<p class="small">${orbs(pendingOrbs)} on the way. They'll show up once your payment goes through.</p>` : ""}
    </div>`;
  renderAiOrbs(aiOrbs, orbsPerAiUnit);
  $("ledger").innerHTML = entries.length ? entries.map(e => `<li>
      <span>${esc((ENTRY_TEXT[e.kind] ?? (() => e.kind))(e))}</span>
      <span class="amount ${e.amount > 0 ? "plus" : ""}">${e.amount > 0 ? "+" : ""}${orbs(e.amount)}</span>
      <span class="small">${date(e.createdAt)}</span></li>`).join("")
    : `<li class="hint">Nothing yet. Orbs you buy and spend show up here.</li>`;

  const topUp = async (amount, button) => {
    button.disabled = true;
    const res = await api("/api/wallet/topup", { method: "POST", body: { amount } });
    button.disabled = false;
    if (res.data.url) location.href = res.data.url; else toast(res.data.error);
  };
  $("wallet-panel").querySelectorAll("[data-topup]").forEach(b => b.addEventListener("click", () => topUp(Number(b.dataset.topup), b)));
  const custom = $("topup-custom");
  custom?.elements.orbs.addEventListener("input", e => {
    const n = Number(e.target.value);
    $("custom-price").textContent = n >= limits.minTopup && n <= limits.maxTopup && n % 100 === 0 ? `${money(n)} by card` : "";
  });
  custom?.addEventListener("submit", e => {
    e.preventDefault();
    topUp(Math.round(Number(e.target.elements.orbs.value)), e.target.querySelector("button"));
  });
  // Just back from Stripe: the webhook usually lands within a few seconds.
  if (retry && pendingOrbs) setTimeout(async () => { await loadWallet(false); refreshUser(); }, 3000);
  else if (retry) refreshUser();
}

// "When my free AI messages run out, use orbs."
function renderAiOrbs(on, perUnit) {
  const box = $("ai-orbs");
  box.hidden = false;
  box.innerHTML = `
    <span class="slot">${icon("eye")}</span>
    <div>
      <label class="check-row"><input type="checkbox" id="ai-orbs-on" ${on ? "checked" : ""}> When my free AI messages run out, use orbs</label>
      <p class="small">The Forge mentor, AI Maker and Site Maker share your free messages each day. With this on, each extra message costs ${orbs(perUnit)}, and a Site Maker build counts as several messages. If the AI fails or can't finish, you get the orbs back. It's off until you turn it on. <a href="/orbs">What do orbs cost?</a></p>
    </div>`;
  $("ai-orbs-on").addEventListener("change", async e => {
    const want = e.target.checked;
    e.target.disabled = true;
    const res = await api("/api/wallet/ai-orbs", { method: "PATCH", body: { on: want } });
    e.target.disabled = false;
    if (!res.ok) { e.target.checked = !want; return toast(res.data.error); }
    toast(want ? `On. Extra AI messages will cost ${orbs(perUnit)} each.` : "Off. AI messages stop when your free ones run out.");
  });
}

// ---------- Age group ----------
const METHOD_TEXT = { credit_card: "a credit card check", id_scan: "an ID scan" };

async function loadAge(polls = 0) {
  const r = await api(`/api/age${ageCheck ? `?check=${ageCheck}` : ""}`);
  if (!r.ok) { $("age-status").innerHTML = `<p class="error">${esc(r.data.error)}</p>`; return; }
  const { user, check, available } = r.data;
  const adult = user.ageGroup === "adult";
  const latest = ["pending", "failed"].includes(check?.status) ? check : null;
  $("age-status").innerHTML = adult ? `
      <span class="slot">${icon(user.ageMethod === "id_scan" ? "idcard" : "card")}</span>
      <div><p><span class="pill pill-done">Adult</span> Confirmed by ${METHOD_TEXT[user.ageMethod] ?? "a check"} on ${date(user.ageConfirmedAt)}.</p></div>`
    : `
      <span class="slot">${icon("book")}</span>
      <div class="grow">
        <p><span class="pill pill-muted">Teen</span> Every account starts in the teen group, like on Discord. Confirm you're an adult to ${await adultPerks()}.</p>
        ${latest?.status === "pending" ? `<p class="small">Checking your ${latest.method === "id_scan" ? "ID" : "card"}… ${ageCheck ? "This updates by itself, and an ID check can take a few minutes." : "Reload this page in a minute to see the result."}</p>` : ""}
        ${latest?.status === "failed" && latest.message && latest.message !== "You started a newer check." ? `<p class="error">${esc(latest.message)}</p>` : ""}
      </div>
      ${available ? `<button class="btn btn-buy" type="button" data-confirm-age>Confirm your age</button>` : ""}`;
  // Back from Stripe: keep checking until the result is in. Card checks take seconds;
  // ID checks can take minutes, so slow down after the first half minute (up to 10 minutes).
  if (check?.status === "pending" && ageCheck && polls < 60) setTimeout(() => loadAge(polls + 1), polls < 12 ? 2500 : 10_000);
  if (ageCheck && check?.status === "passed") {
    toast("You're confirmed as an adult.");
    await refreshUser();
    loadShowcase(); // offers the 18+ option now
  }
}

// ---------- Showcase ----------
async function loadShowcase() {
  const r = await api("/api/showcase/mine");
  const { listings = [], credits = 0 } = r.data;
  const labels = { pending: "Waiting for approval", approved: "Live", hidden: "Hidden" };
  const tones = { pending: "wait", approved: "done", hidden: "muted" };
  let html = listings.map(l => `<div class="panel listing-row">
      <div><strong>${esc(l.title)}</strong> <span class="pill pill-${tones[l.status]}">${labels[l.status]}</span>${l.adultOnly ? ` <span class="pill pill-adult">18+</span>` : ""}
      <p class="small"><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.url)}</a></p></div>
      <button class="btn btn-small" type="button" data-remove="${l.id}">Remove</button></div>`).join("");
  if (credits > 0) {
    html += `<form class="panel form" id="listing-form">
      <p>You have ${credits} unused showcase slot${credits > 1 ? "s" : ""}. Listings go live after a quick review.</p>
      <label>Title<input name="title" required maxlength="80" placeholder="Skyblock Server"></label>
      <label>Link<input name="url" type="url" required maxlength="300" placeholder="https://"></label>
      <label>Short description<input name="description" maxlength="300" placeholder="What makes it worth a visit?"></label>
      ${getUser()?.ageGroup === "adult" ? `<label class="check-row"><input type="checkbox" name="adultOnly"> 18+ only: show it to confirmed adults</label>` : ""}
      <button class="btn btn-buy" type="submit">Submit listing</button></form>`;
  } else if (!listings.length) {
    html = `<p class="hint">Buy a showcase slot to list a website or server on the homepage.</p>
      <button class="btn" type="button" data-buy="showcase">Buy a showcase slot for $3</button>`;
  }
  $("showcase").innerHTML = html;
  $("listing-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const res = await api("/api/showcase", { method: "POST", body: { ...f, adultOnly: f.adultOnly === "on" } });
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
registerIcons({ "rbx-brick": { c: { h: "#f07a6e", r: "#d9372b", R: "#9b1c14" }, m: [
  "........", ".hr..hr.", ".rR..rR.", "hhhhhhhh", "hrrrrrrR", "hrrrrrrR", "hrrrrrrR", "RRRRRRRR"] } });
const KINDS = {
  mod: { icon: "pickaxe", label: "Mod", again: "/#forge" },
  texturepack: { icon: "painting", label: "Texture pack", again: "/textures" },
  modpack: { icon: "chest", label: "Modpack", again: "/modpacks" },
  plugin: { icon: "anvil", label: "Server plugin", again: "/plugins" },
  roblox: { icon: "rbx-brick", label: "Roblox game", again: "/roblox" },
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
    : `<p class="hint">Mods, plugins, texture packs, modpacks and Roblox games you make while signed in show up here.</p><a class="btn" href="/#tools">Open the free tools</a>`;
}

// ---------- Creator page (after saved creations) ----------
async function loadCreator() {
  const r = await api("/api/creators/mine");
  if (!r.ok) return;
  const { profile, referral } = r.data;
  $("creator-section")?.remove();
  $("mods").closest(".acct-section").insertAdjacentHTML("afterend", `
    <section class="acct-section" id="creator-section">
      <h2>Your creator page</h2>
      ${profile ? `<p>Your page is at <a href="${esc(profile.url)}">${esc(location.host + profile.url)}</a>.
          ${referral.referred ? `${referral.referred} ${referral.referred === 1 ? "person" : "people"} joined through your link.` : ""}</p>
        <a class="btn" href="/creators#yours">Edit your page</a>`
      : `<p>Show off what you make, earn badges, and let fans support you directly.</p>
        <a class="btn" href="/creators#yours">Make your creator page</a>`}
    </section>`);
}

// ---------- Email settings ----------
{
  const box = $("email-updates");
  onUser(user => { if (user) box.checked = user.emailUpdates !== false; });
  box?.addEventListener("change", async () => {
    const r = await api("/api/me", { method: "PATCH", body: { emailUpdates: box.checked } });
    if (!r.ok) { box.checked = !box.checked; return toast(r.data.error || "That didn't save. Try again."); }
    toast(box.checked ? "Update emails are on." : "Update emails are off. Receipts still arrive.");
  });
}

// ---------- Account type ----------
{
  const set = $("account-type"), note = $("business-note");
  const show = type => {
    set.querySelectorAll("input").forEach(i => { i.checked = i.value === type; });
    note.hidden = type !== "business";
  };
  onUser(user => { if (user) show(user.accountType ?? "personal"); });
  set?.addEventListener("change", async e => {
    const type = e.target.value;
    const r = await api("/api/me", { method: "PATCH", body: { accountType: type } });
    if (!r.ok) { show(getUser()?.accountType ?? "personal"); return toast(r.data.error || "That didn't save. Try again."); }
    note.hidden = type !== "business";
    await refreshUser();
    toast(`Account type set to ${type}.`);
  });
}

// ---------- Get paid (Stripe Connect, src/payouts.js) ----------
{
  const box = $("payout-box");
  const usd = c => `$${(c / 100).toFixed(2)}`;
  async function loadPayouts() {
    if (!getUser()) return;
    const r = await api("/api/payouts/mine");
    if (!r.ok) { box.innerHTML = `<p class="error">${esc(r.data.error)}</p>`; return; }
    const p = r.data;
    if (!p.canConnect) {
      box.innerHTML = `<p class="small">Stripe needs account holders to be 18 or over. Confirm your age to get paid.</p><button class="btn" type="button" data-pay="age">Confirm my age</button>`;
      return;
    }
    if (!p.ready) {
      box.innerHTML = `<p class="small">${p.connected ? "Stripe still needs a few details before you can take payments." : `ForgeCenter keeps ${p.feePercent}% of each sale; Stripe's own card fee comes out of the rest.`}</p>
        <button class="btn btn-buy" type="button" data-pay="connect">${p.connected ? "Finish connecting Stripe" : "Connect Stripe"}</button>`;
      return;
    }
    box.innerHTML = `
      <p class="note">Stripe is connected. ForgeCenter keeps ${p.feePercent}% of each sale.</p>
      <ul class="pay-links">${p.links.map(l => `<li><span><strong>${esc(l.title)}</strong> ${usd(l.amount)}${l.hidden ? " (hidden by ForgeCenter)" : ""}</span>
        <span class="ticket-actions"><button class="btn btn-small" type="button" data-copy="${l.id}">Copy link</button><button class="btn btn-small btn-danger" type="button" data-del="${l.id}">Delete</button></span></li>`).join("") || `<li class="hint">No pay links yet.</li>`}</ul>
      <form id="paylink-form" class="form">
        <label>What are you selling?<input name="title" maxlength="80" required placeholder="Custom Minecraft skin"></label>
        <label>Details (optional)<input name="description" maxlength="300" placeholder="Delivered as a PNG within 3 days"></label>
        <label>Price in US dollars<input name="amount" type="number" min="1" max="1000" step="0.01" required placeholder="5.00"></label>
        <button class="btn btn-buy" type="submit">Make pay link</button>
      </form>
      <p class="small">Pay links also show on your creator page. <button class="link-btn" type="button" data-pay="dashboard">Open my Stripe dashboard</button> for payouts and refunds.</p>`;
    $("paylink-form").addEventListener("submit", async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const c = await api("/api/payouts/links", { method: "POST", body: { title: f.get("title"), description: f.get("description"), amount: Number(f.get("amount")) } });
      if (!c.ok) return toast(c.data.error);
      toast("Pay link made. Copy it and share it anywhere.");
      loadPayouts();
    });
  }
  box?.addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.pay === "age") return openAgeConfirm("Stripe needs account holders to be 18 or over.");
    if (b.dataset.pay === "connect" || b.dataset.pay === "dashboard") {
      b.disabled = true;
      const r = await api(`/api/payouts/${b.dataset.pay}`, { method: "POST" });
      if (r.ok) location.href = r.data.url; else { b.disabled = false; toast(r.data.error); }
    }
    if (b.dataset.copy) {
      const url = `${location.origin}/pay?l=${b.dataset.copy}`;
      try { await navigator.clipboard.writeText(url); toast("Link copied."); } catch { prompt("Copy this link:", url); }
    }
    if (b.dataset.del && confirm("Delete this pay link? People with the link won't be able to pay it.")) {
      const r = await api(`/api/payouts/links/${b.dataset.del}`, { method: "DELETE" });
      if (!r.ok) return toast(r.data.error);
      loadPayouts();
    }
  });
  onUser(user => { if (user) loadPayouts(); });
}
