import { $, api, esc, icon, money, toast, requireSignIn, onUser, PRODUCT_ICON } from "./common.js";

// ---------- Crafting table ----------
// key matches src/catalog.js; pattern is the 3x3 recipe shape.
const ITEMS = [
  { key: "website",  icon: "monitor", label: "Website",          pattern: "xxx.x.xxx" },
  { key: "game",     icon: "diamond", label: "Game",             pattern: ".x.xxx.x." },
  { key: "discord",  icon: "bot",     label: "Discord bot",      pattern: "x.x.x.x.x" },
  { key: "mcserver", icon: "grass",   label: "Minecraft server", pattern: "xxxxxxxxx" },
  { key: "ai",       icon: "eye",     label: "Dedicated AI",     pattern: ".x.x.x.x." },
  { key: "mod",      icon: "pickaxe", label: "Minecraft mod",    pattern: "xxx.x..x." },
  { key: "learn",    icon: "book",    label: "Learn to code",    pattern: "x..xx.xxx" },
];
const FREE = {
  mod:   { name: "Minecraft mod", desc: "Free. Generate a mod project in your name and publish it to Modrinth.", href: "#forge", cta: "Open Mod Forge" },
  learn: { name: "Coding lessons", desc: "Free with a Google account. Learn step by step with Forge, your AI mentor.", href: "#mentor", cta: "Start learning" },
};

let catalog = {};
api("/api/catalog").then(r => {
  if (!r.ok) { $("trades").innerHTML = `<p class="hint">Prices couldn't load. Refresh the page to try again.</p>`; return; }
  catalog = r.data; renderTrades();
});

const grid = $("grid");
for (let i = 0; i < 9; i++) grid.insertAdjacentHTML("beforeend", `<div class="slot"></div>`);
const hotbar = $("hotbar");
hotbar.innerHTML = ITEMS.map(it =>
  `<button class="hot" type="button" aria-pressed="false" data-key="${it.key}" title="${it.label}">${icon(it.icon, it.label)}</button>`).join("");

let craftRun = 0;
hotbar.addEventListener("click", e => {
  const btn = e.target.closest(".hot"); if (!btn) return;
  hotbar.querySelectorAll(".hot").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
  craft(ITEMS.find(i => i.key === btn.dataset.key));
});

function craft(item) {
  const run = ++craftRun;
  const step = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 55;
  const slots = [...grid.children];
  slots.forEach(s => (s.innerHTML = ""));
  $("out").innerHTML = ""; $("out").classList.remove("pop");
  const filled = [...item.pattern].map((ch, i) => (ch === "x" ? i : -1)).filter(i => i >= 0);
  filled.forEach((idx, n) => setTimeout(() => { if (run === craftRun) slots[idx].innerHTML = icon(item.icon); }, n * step));
  setTimeout(() => {
    if (run !== craftRun) return;
    $("out").innerHTML = icon(item.icon, item.label);
    void $("out").offsetWidth; $("out").classList.add("pop");
    showResult(item);
  }, step ? filled.length * step + 120 : 0);
}

const priceHtml = p => `<span class="price"><span class="gem">${icon("emerald")}</span>${
  p.price ? money(p.price) : money(p.monthly)}${!p.price && p.monthly ? '<span class="per">a month</span>' : ""}${
  p.price && p.monthly ? `<span class="per">+ ${money(p.monthly)}/mo</span>` : ""}</span>`;

function showResult(item) {
  const free = FREE[item.key];
  if (free) {
    $("result").innerHTML = `<h3>${free.name}</h3><p>${free.desc}</p><a class="btn btn-buy" href="${free.href}">${free.cta}</a>`;
    return;
  }
  const p = catalog[item.key];
  if (!p) { $("result").innerHTML = `<p class="hint">Prices are still loading.</p>`; return; }
  $("result").innerHTML = `<h3>${esc(p.name)}</h3><p>${esc(p.desc)}</p>
    <div class="price-line">${priceHtml(p)}<button class="btn btn-buy" type="button" data-buy="${item.key}">Go to checkout</button></div>`;
}

// ---------- Villager-style trade list ----------
function renderTrades() {
  const order = ["website", "mcserver", "discord", "game", "ai", "showcase"];
  $("trades").innerHTML = order.filter(k => catalog[k]).map(k => {
    const p = catalog[k];
    return `<div class="trade${k === "website" ? " featured" : ""}">
      <div class="slot">${icon(PRODUCT_ICON[k])}</div>
      <div><h3>${esc(p.name)}</h3><p>${esc(p.desc)}</p></div>
      ${priceHtml(p)}
      <button class="btn btn-buy" type="button" data-buy="${k}">Trade</button>
    </div>`;
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
    $("mentor-usage").textContent = `${r.data.remaining} messages left today.`;
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
  if (r.ok) $("mentor-usage").textContent = `${Math.max(0, r.data.limit - r.data.used)} of ${r.data.limit} messages left today.`;
});

// ---------- Showcase ----------
api("/api/showcase").then(r => {
  const list = r.data.listings ?? [];
  if (!list.length) return;
  $("showcase-list").innerHTML = list.map(l => `
    <a class="panel listing" href="${esc(l.url)}" rel="noopener nofollow ugc" target="_blank">
      <h3>${esc(l.title)}</h3><p>${esc(l.description)}</p><span class="small">By ${esc(l.owner)}</span>
    </a>`).join("");
});

if (new URLSearchParams(location.search).get("signin") === "1") requireSignIn(() => {});
