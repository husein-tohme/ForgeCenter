import { $, api, esc, icon, money, orbs, toast, refreshUser, requireSignIn, onUser, getUser, getCatalog, ready, PRODUCT_ICON } from "./common.js";
import { reportButton } from "./report.js";
import { coverUrl } from "./covers.js";

let catalog = {};
getCatalog().then(data => {
  if (!Object.keys(data).length) { $("trades").innerHTML = `<p class="hint">Prices couldn't load. Refresh the page to try again.</p>`; return; }
  catalog = data; renderTrades();
});

// ---------- Live now: real games from the launchpad, as server-list rows ----------
const PLATFORM = { "minecraft-server": "Minecraft server", "minecraft-map": "Minecraft map", "minecraft-mod": "Minecraft mod", roblox: "Roblox", web: "Web browser", steam: "Steam", itch: "itch.io", other: "Game" };
api("/api/games").then(r => {
  const games = (r.data.games ?? []).filter(g => !g.restricted).slice(0, 6);
  if (!games.length) {
    $("live-games").innerHTML = `<div class="srv-empty"><p><strong>No games are live yet.</strong> Made a Minecraft server, map, mod or Roblox game? Put it here for $1 a month and be the first one players see.</p></div>`;
    return;
  }
  $("live-count").textContent = `${games.length === 6 ? "Newest 6" : games.length} live · creators keep a game here for $1 a month`;
  $("live-games").innerHTML = games.map(g => `
    <a class="srv srv-link" href="/game?id=${g.id}">
      <img class="srv-art" src="${coverUrl(g)}" alt="" width="128" height="72">
      <span class="srv-main">
        <span class="srv-top"><span class="srv-name">${esc(g.title)}</span></span>
        <span class="srv-motd">${esc(g.tagline || "")}</span>
        <span class="srv-by">by ${esc(g.creator || "a creator")}</span>
      </span>
      <span class="srv-side">
        <span class="status"><span class="dot"></span>Live</span>
        <span class="srv-where">${esc(g.serverAddress || PLATFORM[g.platform] || "Game")}</span>
      </span>
    </a>`).join("");
});

const priceHtml = p => `<span class="price"><span class="gem">${icon("emerald")}</span>${
  p.price ? money(p.price) : money(p.monthly)}${!p.price && p.monthly ? '<span class="per">a month</span>' : ""}${
  p.price && p.monthly ? `<span class="per">+ ${money(p.monthly)}/mo</span>` : ""}</span>`;
// One-time items can also be paid with orbs (1 orb = 1 cent).
const orbLine = (p, tag = "span") => p.orbPayable ? `<${tag} class="per">or <a href="/orbs">${orbs(p.price)}</a></${tag}>` : "";

// ---------- Price cards: one colour per product, so the list reads at a glance ----------
const COLOR = { website: "#3b82f6", mcserver: "#4caf50", discord: "#7c5cff", game: "#22c3d6", roblox: "#e5483b", launcher: "#f28c28", ai: "#14b8a6", showcase: "#e8b923" };
const per = p => p.price ? (p.monthly ? `+ ${money(p.monthly)}/month` : "one-time") : "a month";
function renderTrades() {
  const order = ["mcserver", "discord", "ai", "website", "launcher", "showcase", "roblox", "game"];
  $("trades").innerHTML = order.filter(k => catalog[k]).map(k => {
    const p = catalog[k];
    return `<article class="price-card" style="--c:${COLOR[k]}">
      <div class="pc-top"><span class="pc-icon">${icon(PRODUCT_ICON[k])}</span><h3>${esc(p.name.replace(/ \(deposit\)$/, ""))}</h3></div>
      <p class="pc-price">${money(p.price || p.monthly)}<span>${per(p)}</span></p>
      <p class="pc-desc">${esc(p.desc)}</p>
      ${p.orbPayable ? `<p class="pc-orbs">or ${orbs(p.price)}</p>` : ""}
      ${p.adultOnly ? `<p class="pc-note">18+ · confirm your age first</p>` : ""}
      <button class="btn btn-buy pc-buy" type="button" data-buy="${k}">${p.monthly && !p.price ? "Start" : "Buy"}</button>
    </article>`;
  }).join("");
}

// ---------- Mod Forge ----------
const form = $("mod-form");
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
function modData() {
  const f = new FormData(form);
  return {
    name: f.get("name").trim(), author: f.get("author").trim(), description: f.get("description").trim(),
    items: f.get("items").split(",").map(s => s.trim()).filter(Boolean), token: f.get("token").trim(),
  };
}
function updatePreview() {
  const d = modData();
  const id = slug(d.name) || "my_mod";
  $("mod-preview").textContent = JSON.stringify({
    schemaVersion: 1, id, version: "1.0.0",
    name: d.name || "My Mod", description: d.description || "",
    authors: [d.author || "you"], license: "MIT",
    items: d.items.map(i => `${id}:${slug(i)}`),
    depends: { minecraft: "~1.21.1", "fabric-api": "*" },
  }, null, 2);
}
form.addEventListener("input", updatePreview);
updatePreview();
onUser(u => { if (u && !form.author.value) form.author.placeholder = u.name; });

function missingField() {
  for (const el of form.querySelectorAll("[required]")) if (!el.value.trim()) return el;
}
form.addEventListener("submit", async e => {
  e.preventDefault();
  const miss = missingField();
  if (miss) { miss.focus(); return toast(`Add ${miss.closest("label").firstChild.textContent.trim().toLowerCase()} to continue.`); }
  const r = await fetch("/api/mod/zip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(modData()) });
  if (!r.ok) return toast((await r.json()).error);
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(await r.blob()), download: `${slug(modData().name)}.zip` });
  a.click();
  toast("Mod project downloaded.");
});
$("mod-publish").addEventListener("click", async e => {
  const miss = missingField();
  if (miss) { miss.focus(); return toast("Fill in the mod name, your name and what it adds first."); }
  if (!modData().token) return toast("Paste your Modrinth token to create a draft.");
  e.target.disabled = true;
  const r = await api("/api/mod/modrinth", { method: "POST", body: modData() });
  e.target.disabled = false;
  toast(r.data.url ? `Draft created on Modrinth: ${r.data.url}` : `Modrinth said: ${r.data.error}`);
});

// ---------- Mentor chat ----------
const history = [];
function renderChat(pending) {
  if (!history.length && !pending) return;
  $("chat").innerHTML = history.map(m =>
    `<p class="msg ${m.role === "user" ? "msg-user" : "msg-ai"}"><b>${m.role === "user" ? "You" : "Forge"}</b>${esc(m.content)}</p>`).join("")
    + (pending ? `<p class="msg msg-ai"><b>Forge</b>Thinking…</p>` : "");
  $("chat").scrollTop = $("chat").scrollHeight;
}
async function ask(text) {
  if (!text) return;
  history.push({ role: "user", content: text }); renderChat(true);
  const r = await api("/api/tutor", { method: "POST", body: { messages: history } });
  if (r.data.reply) {
    history.push({ role: "assistant", content: r.data.reply });
    $("mentor-usage").textContent = r.data.orbsSpent
      ? `No free messages left today, so that one cost ${orbs(r.data.orbsSpent)}.`
      : `${r.data.remaining} messages left today.`;
    if (r.data.orbsSpent) refreshUser(); // the header shows the new orb count
  } else { history.pop(); toast(r.data.error || "Forge couldn't answer. Try again."); }
  renderChat(false);
}
$("chat-form").addEventListener("submit", e => {
  e.preventDefault();
  const t = $("q").value.trim();
  if (!t) return;
  requireSignIn(() => { $("q").value = ""; ask(t); });
});
$("starters").addEventListener("click", e => {
  if (e.target.matches(".chip")) requireSignIn(() => ask(e.target.textContent));
});
onUser(async u => {
  if (!u) { $("mentor-usage").textContent = "Sign in with Google to chat with Forge. It's free."; return; }
  const r = await api("/api/tutor/usage");
  if (!r.ok) return;
  const left = Math.max(0, r.data.limit - r.data.used);
  $("mentor-usage").textContent = left || !r.data.aiOrbs
    ? `${left} of ${r.data.limit} messages left today.`
    : `No free messages left today. Each message costs ${orbs(r.data.orbsPerAiUnit)}.`;
});

// ---------- Showcase ----------
// 18+ listings come back as placeholders for anyone who isn't a confirmed adult,
// shown like Discord's age-restricted channels.
const restricted = () => `
  <div class="panel listing restricted">
    <span class="gate-icon">${icon("barrier")}</span>
    <h3>Age-restricted listing</h3>
    <p>This listing is for adults (18+). ${getUser()
      ? "Your account is in the teen group. If that isn't right, confirm you're an adult."
      : "Sign in and confirm you're an adult to see it."}</p>
    <button class="btn btn-small" type="button" data-confirm-age>Confirm age</button>
  </div>`;

Promise.all([api("/api/showcase"), ready]).then(([r]) => {
  const list = r.data.listings ?? [];
  if (!list.length) return;
  // The title link covers the whole card (see css/reports.css); Report sits above it.
  $("showcase-list").innerHTML = list.map(l => l.restricted ? restricted() : `
    <article class="panel listing listing-card">
      <h3><a class="listing-link" href="${esc(l.url)}" rel="noopener nofollow ugc" target="_blank">${esc(l.title)}</a></h3>
      <p>${esc(l.description)}</p>
      <div class="listing-foot"><span class="small">By ${esc(l.owner)}</span>${l.adultOnly ? ` <span class="pill pill-adult">18+</span>` : ""}
        ${reportButton("listing", l.id)}</div>
    </article>`).join("");
});

if (new URLSearchParams(location.search).get("signin") === "1") requireSignIn(() => {});
