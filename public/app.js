// ---------- Pixel icons (8x8, drawn from string maps) ----------
const ICONS = {
  pickaxe: { c: { c: "#4ee2ec", C: "#1f9da6", s: "#8b5a2b" }, m: [
    ".cccccc.", "cC.ss.Cc", "c..ss..c", "...ss...", "...ss...", "...ss...", "...ss...", "...ss..."] },
  monitor: { c: { k: "#3a3a3a", b: "#3b7bd6", w: "#9cc7ff" }, m: [
    "kkkkkkkk", "kwwbbbbk", "kwbbbbbk", "kbbbbbbk", "kbbbbbbk", "kkkkkkkk", "...kk...", ".kkkkkk."] },
  bot: { c: { o: "#5b3a91", O: "#9b6fd9", w: "#ffffff", k: "#2a1846" }, m: [
    "oooooooo", "oOOOOOOo", "oOwOOwOo", "oOkOOkOo", "oOOOOOOo", "oOkkkkOo", "oOOOOOOo", "oooooooo"] },
  grass: { c: { G: "#5da33a", g: "#4a8a2c", d: "#8b5a2b", D: "#6e4320" }, m: [
    "GGGGGGGG", "GgGGgGGG", "gdgGdgGd", "dddddddd", "dDdddDdd", "ddDdddDd", "dddDdddd", "dDddddDd"] },
  diamond: { c: { c: "#4ee2ec", w: "#e8ffff", C: "#1f9da6" }, m: [
    "........", "...cc...", "..cwcc..", ".cwcccc.", "cccccccC", ".cccccC.", "..cccC..", "...cC..."] },
  eye: { c: { t: "#1c6b5a", T: "#3fbf9b", k: "#0f2a24" }, m: [
    "..tttt..", ".tTTTTt.", "tTTkkTTt", "tTkkkkTt", "tTkkkkTt", "tTTkkTTt", ".tTTTTt.", "..tttt.."] },
  book: { c: { b: "#5a3416", B: "#8e5426", g: "#f2c230", p: "#ede6d6" }, m: [
    "..bbbbb.", ".bBBBBBb", ".bBBBBBb", ".bBggBBb", ".bBBBBBb", ".bBBBBBb", ".bpppppb", "..bbbbb."] },
  emerald: { c: { e: "#3bd16f", w: "#c8ffd8", E: "#13843b" }, m: [
    "...ee...", "..ewee..", ".ewEeee.", ".eeeeeE.", ".eeeeeE.", ".eeeeEE.", "..eeEE..", "...EE..."] },
  anvil: { c: { a: "#5c5f66", A: "#8a8e96", k: "#2e3035" }, m: [
    "........", "AAAAAAAk", ".aaaaak.", "...ak...", "...ak...", "..aaak..", ".aaaaaak", ".kkkkkkk"] },
  frame: { c: { f: "#8e5426", F: "#5a3416", l: "#c9a46a" }, m: [
    "ffffffff", "fllllllF", "fl....lF", "fl....lF", "fl....lF", "fl....lF", "fllllllF", "FFFFFFFF"] },
};

function icon(name, label = "") {
  const { c, m } = ICONS[name];
  let rects = "";
  m.forEach((row, y) => [...row].forEach((ch, x) => {
    if (c[ch]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c[ch]}"/>`;
  }));
  const a11y = label ? `role="img" aria-label="${label}"` : `aria-hidden="true"`;
  return `<svg class="px" viewBox="0 0 8 8" shape-rendering="crispEdges" ${a11y}>${rects}</svg>`;
}
document.querySelectorAll("[data-icon]").forEach(el => { el.innerHTML = icon(el.dataset.icon); });

// ---------- Helpers ----------
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const money = cents => "$" + (cents / 100).toLocaleString("en-US");
let toastTimer;
function toast(text) {
  const t = $("toast");
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 5000);
}
async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r;
}

if (new URLSearchParams(location.search).get("paid") === "1") {
  toast("Payment received. Check your email for next steps.");
}

// ---------- Products shown in the crafting table and trades ----------
// key matches src/catalog.js; pattern is the 3x3 recipe shape.
const ITEMS = [
  { key: "website",  icon: "monitor", label: "Website",            pattern: "xxx.x.xxx" },
  { key: "game",     icon: "diamond", label: "Game",               pattern: ".x.xxx.x." },
  { key: "discord",  icon: "bot",     label: "Discord bot",        pattern: "x.x.x.x.x" },
  { key: "mcserver", icon: "grass",   label: "Minecraft server",   pattern: "xxxxxxxxx" },
  { key: "ai",       icon: "eye",     label: "Dedicated AI",       pattern: ".x.x.x.x." },
  { key: "mod",      icon: "pickaxe", label: "Minecraft mod",      pattern: "xxx.x..x." },
  { key: "learn",    icon: "book",    label: "Learn to code",      pattern: "x..xx.xxx" },
];
const FREE = {
  mod:   { name: "Minecraft mod", desc: "Free. Generate a mod project in your name and publish it to Modrinth.", href: "#forge", cta: "Open Mod Forge" },
  learn: { name: "Coding lessons", desc: "Free. Learn step by step with Forge, your AI mentor.", href: "#mentor", cta: "Start learning" },
};

let catalog = {};
fetch("/api/catalog").then(r => r.json()).then(c => { catalog = c; renderTrades(); }).catch(() => {
  $("trades").innerHTML = `<p class="hint">Prices couldn't load. Refresh the page to try again.</p>`;
});

// Crafting grid
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
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const slots = [...grid.children];
  slots.forEach(s => (s.innerHTML = ""));
  $("out").innerHTML = ""; $("out").classList.remove("pop");
  const filled = [...item.pattern].map((ch, i) => (ch === "x" ? i : -1)).filter(i => i >= 0);
  filled.forEach((idx, n) => setTimeout(() => {
    if (run === craftRun) slots[idx].innerHTML = icon(item.icon);
  }, reduce ? 0 : n * 55));
  setTimeout(() => {
    if (run !== craftRun) return;
    $("out").innerHTML = icon(item.icon, item.label);
    void $("out").offsetWidth; $("out").classList.add("pop");
    showResult(item);
  }, reduce ? 0 : filled.length * 55 + 120);
}

function showResult(item) {
  const free = FREE[item.key];
  if (free) {
    $("result").innerHTML = `<h3>${free.name}</h3><p>${free.desc}</p>
      <a class="btn btn-buy" href="${free.href}">${free.cta}</a>`;
    return;
  }
  const p = catalog[item.key];
  if (!p) { $("result").innerHTML = `<p class="hint">Prices are still loading.</p>`; return; }
  $("result").innerHTML = `<h3>${esc(p.name)}</h3><p>${esc(p.desc)}</p>
    <div class="price-line"><span class="price"><span class="gem">${icon("emerald")}</span>${money(p.price)}${p.mode === "subscription" ? '<span class="per">a month</span>' : ""}</span>
    <button class="btn btn-buy" type="button" data-buy="${item.key}">Go to checkout</button></div>`;
}

// Villager-style trade list
function renderTrades() {
  const order = ["website", "mcserver", "discord", "game", "ai", "showcase"];
  const iconFor = { website: "monitor", mcserver: "grass", discord: "bot", game: "diamond", ai: "eye", showcase: "frame" };
  $("trades").innerHTML = order.filter(k => catalog[k]).map(k => {
    const p = catalog[k];
    return `<div class="trade${k === "website" ? " featured" : ""}">
      <div class="slot">${icon(iconFor[k])}</div>
      <div><h3>${esc(p.name)}</h3><p>${esc(p.desc)}</p></div>
      <span class="price"><span class="gem">${icon("emerald")}</span>${money(p.price)}${p.mode === "subscription" ? '<span class="per">/mo</span>' : ""}</span>
      <button class="btn btn-buy" type="button" data-buy="${k}">Trade</button>
    </div>`;
  }).join("");
}

// Any [data-buy] button starts Stripe Checkout
document.addEventListener("click", async e => {
  const btn = e.target.closest("[data-buy]"); if (!btn) return;
  btn.disabled = true;
  try {
    const r = await post("/api/checkout", { product: btn.dataset.buy });
    const d = await r.json();
    if (d.url) location.href = d.url;
    else toast(d.error || "Checkout couldn't start. Try again in a moment.");
  } catch { toast("Checkout couldn't start. Check your connection and try again."); }
  btn.disabled = false;
});

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

function missingField() {
  for (const el of form.querySelectorAll("[required]")) if (!el.value.trim()) return el;
}
form.addEventListener("submit", async e => {
  e.preventDefault();
  const miss = missingField();
  if (miss) { miss.focus(); return toast(`Add ${miss.closest("label").firstChild.textContent.trim().toLowerCase()} to continue.`); }
  const r = await post("/api/mod/zip", modData());
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
  const d = await (await post("/api/mod/modrinth", modData())).json();
  e.target.disabled = false;
  toast(d.url ? `Draft created on Modrinth: ${d.url}` : `Modrinth said: ${d.error}`);
});

// ---------- Mentor chat ----------
const history = [];
function renderChat(pending) {
  $("chat").innerHTML = history.map(m =>
    `<p class="msg ${m.role === "user" ? "msg-user" : "msg-ai"}"><b>${m.role === "user" ? "You" : "Forge"}</b>${esc(m.content)}</p>`).join("")
    + (pending ? `<p class="msg msg-ai"><b>Forge</b>Thinking…</p>` : "");
  $("chat").scrollTop = $("chat").scrollHeight;
}
async function ask(text) {
  if (!text) return;
  history.push({ role: "user", content: text }); renderChat(true);
  try {
    const d = await (await post("/api/tutor", { messages: history })).json();
    if (d.reply) history.push({ role: "assistant", content: d.reply });
    else { history.pop(); toast(d.error || "Forge couldn't answer. Try again."); }
  } catch { history.pop(); toast("Forge couldn't answer. Check your connection and try again."); }
  renderChat(false);
}
$("chat-form").addEventListener("submit", e => { e.preventDefault(); const t = $("q").value.trim(); $("q").value = ""; ask(t); });
$("starters").addEventListener("click", e => { if (e.target.matches(".chip")) ask(e.target.textContent); });
