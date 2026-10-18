// The orbs page: what orbs are, the packs, everything you can spend them on and the rules.
// 1 orb = 1 US cent, so every amount from the server (in cents) is also an orb count.
import { $, api, esc, icon, money, cash, orbs, toast, onUser, getUser, ready, requireSignIn, openSignIn, getCatalog, refreshUser, checkout, stack, PRODUCT_ICON } from "./common.js";

const PACKS = [500, 1000, 2500, 5000, 10000];
const ORDER = ["showcase", "discord", "ai", "launcher", "roblox"]; // cheapest first; others follow by price

const params = new URLSearchParams(location.search);
const returnedTopup = params.has("topup");
if (returnedTopup) {
  toast("Thanks! Your orbs will show up in a moment.");
  // Read once; drop it so a reload doesn't repeat the message.
  params.delete("topup");
  history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "") + location.hash);
}

let info = { limits: { minTopup: 500, maxTopup: 50000, maxBalance: 200000 }, orbsPerAiUnit: 5, available: true };
let wallet = null; // the signed-in person's balance and AI setting, from /api/wallet

$("hero-art").innerHTML = `<span class="slot orb-hero-slot">${icon("orb", "An XP orb")}</span>
  <span class="orb-float orb-float-1">${icon("orb")}</span><span class="orb-float orb-float-2">${icon("orb")}</span><span class="orb-float orb-float-3">${icon("orb")}</span>`;

// ---------- Packs ----------
// A little pile of orbs that grows with the pack.
const pile = amount => {
  const n = Math.min(5, PACKS.indexOf(amount) + 1 || 3);
  return `<span class="orb-pile orb-pile-${n}" aria-hidden="true">${Array.from({ length: n }, () => `<span>${icon("orb")}</span>`).join("")}</span>`;
};

function renderPacks() {
  const { available } = info;
  $("pack-list").innerHTML = PACKS.map(a => `
    <div class="panel orb-pack-card">
      ${pile(a)}
      <p class="orb-pack-count"><span class="num">${a.toLocaleString("en-US")}</span> orbs</p>
      <p class="orb-pack-price">${money(a)}</p>
      <button class="btn btn-buy" type="button" data-pack="${a}" ${available ? "" : "disabled"} aria-label="Buy ${orbs(a)} for ${money(a)}">Buy</button>
    </div>`).join("");
  const { minTopup, maxTopup, maxBalance } = info.limits;
  const input = $("custom-orbs");
  Object.assign(input, { min: minTopup, max: maxTopup });
  $("custom-help").textContent = `Any amount in hundreds, from ${orbs(minTopup)} to ${orbs(maxTopup)}. You can hold up to ${orbs(maxBalance)}.`;
  $("custom-form").querySelector("button").disabled = !available;
  $("packs-unavailable").hidden = available;
}

async function buy(amount, button) {
  button.disabled = true;
  const r = await api("/api/wallet/topup", { method: "POST", body: { amount, from: "orbs" } });
  button.disabled = false;
  if (r.data.url) location.href = r.data.url;
  else if (r.data.needs !== "birthday") toast(r.data.error || "Checkout couldn't start. Try again in a moment.");
}

$("pack-list").addEventListener("click", e => {
  const b = e.target.closest("[data-pack]");
  if (b) requireSignIn(() => buy(Number(b.dataset.pack), b));
});

const validCustom = n => Number.isInteger(n) && n % 100 === 0 && n >= info.limits.minTopup && n <= info.limits.maxTopup;
$("custom-orbs").addEventListener("input", e => {
  const n = Number(e.target.value);
  $("custom-price").textContent = validCustom(n) ? `${money(n)} by card` : "";
});
$("custom-form").addEventListener("submit", e => {
  e.preventDefault();
  const n = Number($("custom-orbs").value);
  if (!validCustom(n)) return toast(`Choose a number of orbs in hundreds, from ${orbs(info.limits.minTopup)} to ${orbs(info.limits.maxTopup)}.`);
  requireSignIn(() => buy(n, e.target.querySelector("button")));
});

// ---------- What can I get with orbs? ----------
let items = [];
async function renderSpend() {
  const catalog = await getCatalog();
  items = Object.entries(catalog).filter(([, p]) => p.orbPayable)
    .sort(([a, pa], [b, pb]) => pa.price - pb.price || ORDER.indexOf(a) - ORDER.indexOf(b));
  if (!items.length) {
    $("spend-list").innerHTML = `<p class="hint">Prices couldn't load. Refresh the page to try again.</p>`;
    return;
  }
  $("spend-list").innerHTML = items.map(([key, p]) => `
    <div class="trade orb-trade" id="get-${esc(key)}">
      <div class="slot">${icon(PRODUCT_ICON[key] ?? "chest")}</div>
      <div>
        <h3>${esc(p.name)}</h3><p>${esc(p.desc)}</p>
        ${p.adultOnly ? `<p class="small">For adults: confirm your age before buying.</p>` : ""}
        <div class="orb-short" data-short="${esc(key)}" hidden></div>
      </div>
      <span class="orb-price"><span class="orb-price-icon">${icon("orb")}</span><span><span class="num">${p.price.toLocaleString("en-US")}</span> orbs<span class="small">${money(p.price)} by card</span></span></span>
      <button class="btn btn-buy" type="button" data-orb-buy="${esc(key)}">Get it with orbs</button>
    </div>`).join("");
}

// Enough orbs: checkout() from common.js asks "Pay with orbs or by card?". Not enough:
// say how many are missing, with a way to get them or to pay by card instead.
$("spend-list").addEventListener("click", e => {
  const b = e.target.closest("[data-orb-buy]");
  if (b) requireSignIn(async () => {
    const key = b.dataset.orbBuy;
    const p = items.find(([k]) => k === key)?.[1];
    if (!p) return;
    const user = getUser();
    if (!user.ageGroup || (p.adultOnly && user.ageGroup !== "adult") || (user.wallet ?? 0) >= p.price) return checkout(key, b);
    const short = p.price - (user.wallet ?? 0);
    const pack = PACKS.find(a => a >= short) ?? null;
    const box = document.querySelector(`[data-short="${CSS.escape(key)}"]`);
    box.innerHTML = `<p class="note">You have ${orbs(Math.max(0, user.wallet ?? 0))}, so you need ${orbs(short)} more for this.
      ${pack ? `The ${orbs(pack)} pack would cover it.` : ""}</p>
      <div class="ticket-actions">
        ${pack ? `<button class="btn btn-small btn-buy" type="button" data-pack-jump="${pack}">Buy ${orbs(pack)}</button>` : `<a class="btn btn-small btn-buy" href="#packs">Buy orbs</a>`}
        <button class="btn btn-small" type="button" data-buy="${esc(key)}">Pay ${money(p.price)} by card</button>
      </div>`;
    box.hidden = false;
    box.querySelector("button, a").focus();
  });
  const jump = e.target.closest("[data-pack-jump]");
  if (jump) {
    const target = $("pack-list").querySelector(`[data-pack="${jump.dataset.packJump}"]`);
    target?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    target?.focus({ preventScroll: true });
  }
});

// ---------- AI messages ----------
async function renderAi(sitesCost) {
  const per = info.orbsPerAiUnit;
  const tools = [
    { icon: "book", name: "Forge mentor", href: "/#mentor", cost: `${orbs(per)} a message`, desc: "Your AI coding mentor: questions, code reviews and small exercises." },
    { icon: "eye", name: "AI Maker chats", href: "/ai-maker", cost: `${orbs(per)} a message`, desc: "Chatting with an AI assistant you made, or one a friend shared with you." },
    ...(sitesCost ? [{ icon: "monitor", name: "Site Maker", href: "/site-maker",
      cost: `${orbs(sitesCost.generate * per)} a new site, ${orbs(sitesCost.refine * per)} a change`,
      desc: `A new site counts as ${sitesCost.generate} messages and each change as ${sitesCost.refine}.` }] : []),
  ];
  $("ai-list").innerHTML = tools.map(t => `
    <a class="panel orb-ai-card" href="${t.href}">
      <span class="slot">${icon(t.icon)}</span>
      <span><strong>${esc(t.name)}</strong><span class="orb-ai-cost">${esc(t.cost)}</span><span class="small">${esc(t.desc)}</span></span>
    </a>`).join("");
}

function renderAiSetting() {
  const box = $("ai-setting");
  const user = getUser();
  if (!user) {
    box.innerHTML = `<p>Paying for extra messages with orbs is off until you turn it on. Sign in to choose.</p>
      <button class="btn" type="button" id="ai-signin">Sign in</button>`;
    $("ai-signin").addEventListener("click", () => openSignIn());
    return;
  }
  if (!wallet) { box.innerHTML = `<p class="hint">Loading your setting…</p>`; return; }
  box.innerHTML = `
    <label class="check-row"><input type="checkbox" id="ai-orbs-on" ${wallet.aiOrbs ? "checked" : ""}> When my free AI messages run out, use orbs</label>
    <p class="small" id="ai-orbs-state">${wallet.aiOrbs
      ? `On. Once your free messages run out, each one costs ${orbs(info.orbsPerAiUnit)}. You have ${orbs(Math.max(0, wallet.balance))}.`
      : "Off. When your free messages run out, the AI tools stop until midnight UTC."}</p>`;
  $("ai-orbs-on").addEventListener("change", async e => {
    const want = e.target.checked;
    e.target.disabled = true;
    const r = await api("/api/wallet/ai-orbs", { method: "PATCH", body: { on: want } });
    e.target.disabled = false;
    if (!r.ok) { e.target.checked = !want; return toast(r.data.error || "That didn't save. Try again."); }
    wallet.aiOrbs = r.data.aiOrbs;
    renderAiSetting();
    $("ai-orbs-on").focus();
    toast(want ? `On. Extra AI messages cost ${orbs(info.orbsPerAiUnit)} each.` : "Off. The AI tools stop when your free messages run out.");
  });
}

// ---------- Rules ----------
function renderRules() {
  const { minTopup, maxTopup, maxBalance } = info.limits;
  const rules = [
    ["Orbs stay on ForgeCenter.", "They can't be withdrawn, cashed out, sold, traded or sent to other people. You can only spend them here."],
    ["Orbs never expire.", "Spend them today or next year."],
    ["1 orb is always 1 cent.", "No bonus orbs and no changing rates, so a price in orbs is the same as the price in cents."],
    ["Changed your mind?", `Orb packs you haven't spent can be refunded to the card you paid with. <a href="/support">Open a support ticket</a> and a person will do it.`],
    ["Limits.", `Buy ${orbs(minTopup)} to ${orbs(maxTopup)} at a time, and hold up to ${orbs(maxBalance)}.`],
    ["Monthly plans are paid by card.", "Things that renew every month, like Minecraft server hosting, need a card so they can renew. Big projects, like a full game, are paid by card too."],
    ["The AI didn't answer?", "If an AI tool fails or can't finish, the orbs for that message come back on their own."],
  ];
  $("rules").innerHTML = rules.map(([t, d]) => `<li><span class="orb-rule-icon">${icon("orb")}</span><span><strong>${esc(t)}</strong> ${d}</span></li>`).join("");
}

// ---------- Balance ----------
async function loadWallet(retry = returnedTopup) {
  const r = await api("/api/wallet");
  if (!r.ok) return;
  wallet = r.data;
  renderBalance();
  renderAiSetting();
  // Just back from Stripe: the webhook usually lands within a few seconds.
  if (retry && wallet.pending.length) setTimeout(async () => { await loadWallet(false); refreshUser(); }, 3000);
  else if (retry) refreshUser();
}

function renderBalance() {
  const box = $("balance");
  const user = getUser();
  if (!user) {
    box.innerHTML = `<button class="btn btn-small" type="button" id="balance-signin">Sign in to see your orbs</button>`;
    $("balance-signin").addEventListener("click", () => openSignIn());
    box.hidden = false;
    return;
  }
  if (!wallet) return;
  const pending = wallet.pending.reduce((n, t) => n + t.amount, 0);
  box.innerHTML = `${stack(wallet.balance, { big: true })}
    <span class="orb-balance-text"><strong>You have <span class="num">${esc(orbs(wallet.balance))}</span></strong>
      <span class="small">Worth ${cash(wallet.balance)}. <a href="/account#wallet">See your orb history</a></span>
      ${pending ? `<span class="small">${esc(orbs(pending))} on the way. They'll show up once your payment goes through.</span>` : ""}</span>`;
  box.hidden = false;
}

// ---------- Start ----------
const [infoRes, limitsRes, sitesRes] = await Promise.all([api("/api/wallet/info"), api("/api/tutor/limits"), api("/api/sites/options")]);
if (infoRes.ok) info = infoRes.data;
if (limitsRes.ok) {
  const { freeDaily, aiPlanDaily } = limitsRes.data;
  $("ai-lede").textContent = `Everyone gets ${freeDaily} free AI messages a day (${aiPlanDaily} with the Dedicated AI assistant), shared by the Forge mentor, AI Maker and Site Maker. When they run out, you can keep going with orbs instead of waiting for midnight UTC.`;
}
renderPacks();
renderRules();
renderAi(sitesRes.ok ? sitesRes.data.cost : null);
renderSpend();

await ready;
// Again when someone signs in or out, or answers the birthday question, but not when the
// same account is re-read (refreshUser after a purchase).
let shownFor;
onUser(user => {
  const key = user ? `${user.id}:${user.ageGroup}` : null;
  if (key === shownFor) return;
  shownFor = key;
  wallet = null;
  renderBalance();
  renderAiSetting();
  if (user?.ageGroup && user.ageGroup !== "under13") loadWallet();
});
