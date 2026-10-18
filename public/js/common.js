// Shared by every page: pixel icons, helpers, Google sign-in and checkout.

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
  chest: { c: { b: "#5a3416", B: "#a0682f", k: "#2e1a0a", g: "#c9c9c9" }, m: [
    "........", ".bbbbbb.", "bBBBBBBb", "bBBBBBBb", "kkkggkkk", "bBBggBBb", "bBBBBBBb", ".bbbbbb."] },
  painting: { c: { f: "#8e5426", s: "#7fb2f0", Y: "#f2c230", g: "#5da33a", d: "#8b5a2b" }, m: [
    "ffffffff", "fsssssYf", "fssssssf", "fsssgssf", "fsggggsf", "fggggggf", "fddddddf", "ffffffff"] },
  frame: { c: { f: "#8e5426", F: "#5a3416", l: "#c9a46a" }, m: [
    "ffffffff", "fllllllF", "fl....lF", "fl....lF", "fl....lF", "fl....lF", "fllllllF", "FFFFFFFF"] },
  card: { c: { c: "#3b7bd6", k: "#1c1c1c", g: "#f2c230", w: "#9cc7ff" }, m: [
    "........", "cccccccc", "kkkkkkkk", "cccccccc", "cggccccc", "cggcwwwc", "cccccccc", "........"] },
  idcard: { c: { f: "#5c5f66", p: "#ede6d6", s: "#e0ac69", h: "#3b7bd6", k: "#8b8b8b" }, m: [
    "........", "ffffffff", "fsspkkpf", "fssppppf", "fhhpkkpf", "fhhppppf", "ffffffff", "........"] },
  gamepad: { c: { k: "#3a3a3a", K: "#6b6f78", w: "#ffffff", r: "#d9372b", b: "#3b7bd6" }, m: [
    "........", "..kkkk..", ".kKKKKk.", "kKwKKrKk", "kwwwKKbk", "kKwKKKKk", "kKKkkKKk", ".kk..kk."] },
  rocket: { c: { w: "#e8e8e8", b: "#3b7bd6", r: "#d9372b", o: "#f2c230" }, m: [
    "...ww...", "..wbbw..", "..wbbw..", "..wwww..", ".rwwwwr.", "rr.ww.rr", "...oo...", "..o..o.."] },
  barrier: { c: { r: "#d9372b" }, m: [
    "..rrrr..", ".rr...r.", "r.rr...r", "r..rr..r", "r...rr.r", "r....rrr", ".r....r.", "..rrrr.."] },
  arcade: { c: { c: "#5b3a91", k: "#2a1846", s: "#3bd16f", S: "#c8ffd8", r: "#d9372b", b: "#3b7bd6" }, m: [
    ".cccccc.", ".kkkkkk.", ".kSsssk.", ".kssssk.", ".kkkkkk.", "ccrccbcc", ".cccccc.", ".c....c."] },
  // An XP orb: ForgeCenter's currency.
  orb: { c: { k: "#2f5208", y: "#7cc11b", Y: "#c6f23d", w: "#fbffd6", g: "#4f8c10" }, m: [
    "..kkkk..", ".kyYYyk.", "kyYwwYyk", "kYwYYYyk", "kYYYYYgk", "kyYYYggk", ".kyggyk.", "..kkkk.."] },
};

// Pages add their own pixel icons, in the same { c: colours, m: 8 rows } format.
export function registerIcons(map) { Object.assign(ICONS, map); }

export function icon(name, label = "") {
  const { c, m } = ICONS[name];
  let rects = "";
  m.forEach((row, y) => [...row].forEach((ch, x) => {
    if (c[ch]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c[ch]}"/>`;
  }));
  const a11y = label ? `role="img" aria-label="${label}"` : `aria-hidden="true"`;
  return `<svg class="px" viewBox="0 0 8 8" shape-rendering="crispEdges" ${a11y}>${rects}</svg>`;
}

export const PRODUCT_ICON = { website: "monitor", mcserver: "grass", discord: "bot", game: "diamond", roblox: "gamepad", launcher: "rocket", ai: "eye", showcase: "frame", launch: "arcade" };

// Order status: label shown on the pill, and what it means for the customer.
export const STATUS = {
  awaiting_payment: { label: "Waiting for payment", tone: "wait", help: "Checkout isn't finished. If you closed it, start a new order from the prices page." },
  paid:             { label: "Paid", tone: "info", help: "Payment received. Write your project brief below so work can start." },
  in_progress:      { label: "In progress", tone: "info", help: "Your project is being built. Updates will appear in the messages below." },
  delivered:        { label: "Delivered", tone: "done", help: "Your project is ready." },
  payment_failed:   { label: "Payment failed", tone: "bad", help: "The payment didn't go through. Start a new order to try again." },
  expired:          { label: "Checkout expired", tone: "muted", help: "Checkout closed before payment. Start a new order whenever you're ready." },
  canceled:         { label: "Canceled", tone: "muted", help: "This order was canceled." },
};
export const SUB_STATUS = {
  active: "Billing is active.",
  past_due: "Your last payment failed. Update your card in Manage billing to keep the service running.",
  canceled: "The subscription is canceled.",
  paused: "Billing is paused.",
};
export const pill = status => {
  const s = STATUS[status] ?? { label: status, tone: "muted" };
  return `<span class="pill pill-${s.tone}">${esc(s.label)}</span>`;
};

// ---------- Helpers ----------
export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
export const money = cents => "$" + (cents / 100).toLocaleString("en-US");
// Always two decimals, for wallet amounts.
export const cash = cents => (cents < 0 ? "−$" : "$") + (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Orbs, ForgeCenter's currency: 1 orb = 1 cent, so wallet amounts in cents are orb counts.
export const orbs = n => `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US")} ${Math.abs(n) === 1 ? "orb" : "orbs"}`;
export const date = iso => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

let toastTimer;
export function toast(text) {
  const t = $("toast");
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 6000);
}

export async function api(path, { method = "GET", body } = {}) {
  try {
    const r = await fetch(path, {
      method, credentials: "same-origin",
      headers: method === "GET" ? {} : { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    const data = r.headers.get("content-type")?.includes("json") ? await r.json() : null;
    if (data?.needs === "birthday") openBirthday();
    // Suspended since the page loaded: re-read the account so the dialog shows the reason.
    if (data?.needs === "suspended") { if (currentUser?.suspended) openSuspended(currentUser.suspended.reason); else refreshUser(); }
    return { ok: r.ok, status: r.status, data: data ?? {} };
  } catch {
    return { ok: false, status: 0, data: { error: "You seem to be offline. Check your connection and try again." } };
  }
}

document.querySelectorAll("[data-icon]").forEach(el => { el.innerHTML = icon(el.dataset.icon); });

// ---------- Session ----------
let currentUser = null;
const listeners = [];
export const getUser = () => currentUser;
export function onUser(fn) { listeners.push(fn); fn(currentUser); }
function setUser(user) {
  currentUser = user;
  renderAuthSlot();
  if (user && !user.ageGroup) openBirthday();
  if (user?.ageGroup === "under13") openClosed();
  if (user?.suspended) openSuspended(user.suspended.reason);
  listeners.forEach(fn => fn(user));
}
// Re-reads the account, for example after a wallet or age change.
export async function refreshUser() {
  const r = await api("/api/me");
  if (r.ok) setUser(r.data.user ?? null);
  return currentUser;
}
export const ready = api("/api/me").then(r => setUser(r.data.user ?? null));
const config = api("/api/config").then(r => r.data);

function renderAuthSlot() {
  const slot = $("auth-slot");
  if (!slot) return;
  if (!currentUser) {
    slot.innerHTML = `<button class="btn btn-small" type="button" id="signin-open">Sign in</button>`;
    $("signin-open").addEventListener("click", () => openSignIn());
    return;
  }
  slot.innerHTML = `${currentUser.isAdmin ? `<a class="top-link" href="/admin">Owner panel</a>` : ""}
    <a class="wallet-chip" href="/orbs" aria-label="Your orbs: ${orbs(currentUser.wallet ?? 0)}">${stack(currentUser.wallet ?? 0)}</a>
    <a class="account-link" href="/account">${currentUser.picture
      ? `<img src="${esc(currentUser.picture)}" alt="" width="32" height="32" referrerpolicy="no-referrer">` : ""}My account</a>`;
}

export async function signOut() {
  await api("/api/auth/logout", { method: "POST" });
  setUser(null);
  toast("Signed out.");
}

// ---------- Sign-in ----------
const PROVIDERS = {
  github: { name: "GitHub", logo: `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>` },
  microsoft: { name: "Microsoft", logo: `<svg viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>` },
  discord: { name: "Discord", logo: "" },
};
export const PROVIDER_NAMES = { google: "Google", whatsapp: "WhatsApp", ...Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, v.name])) };

const AUTH_ERRORS = {
  expired: "That sign-in took too long or was opened in another browser. Try again.",
  denied: "Sign-in was cancelled.",
  failed: "Sign-in didn't work. Try again in a moment.",
  linked_elsewhere: "That account is already connected to a different ForgeCenter account.",
  already_connected: "Your account already has that kind of sign-in. Remove it first to connect a different one.",
};
const RESUME = "fc-resume";
let pendingAction = null;
let pendingResume = null;
let googleLink = false;
let gis;

function dialog() {
  let d = $("signin-dialog");
  if (d) return d;
  document.body.insertAdjacentHTML("beforeend", `
    <dialog class="panel signin" id="signin-dialog" aria-labelledby="signin-title">
      <h2 id="signin-title">Sign in to ForgeCenter</h2>
      <p>Use an account you already have. ForgeCenter never sees your password.</p>
      <div id="signin-options" class="signin-options"></div>
      <p class="small">By signing in you agree to the <a href="/terms">terms</a> and the <a href="/privacy">privacy policy</a>.</p>
      <button class="btn" type="button" id="signin-close">Not now</button>
    </dialog>`);
  d = $("signin-dialog");
  $("signin-close").addEventListener("click", () => { pendingAction = null; pendingResume = null; d.close(); });
  d.addEventListener("cancel", () => { pendingAction = null; pendingResume = null; });
  return d;
}

function loadGis(clientId) {
  return gis ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = () => {
      google.accounts.id.initialize({ client_id: clientId, callback: onCredential, ux_mode: "popup", cancel_on_tap_outside: true });
      resolve();
    };
    s.onerror = () => { gis = null; reject(new Error("blocked")); };
    document.head.append(s);
  });
}

function signedIn(user, how) {
  if (googleLink || how === "link") { location.href = `/account?connected=${how === "link" ? "whatsapp" : "google"}`; return; }
  $("signin-dialog")?.close();
  setUser(user);
  toast(`Signed in as ${user.name}.`);
  const action = pendingAction; pendingAction = null; pendingResume = null;
  action?.();
}

async function onCredential({ credential }) {
  const r = await api("/api/auth/google", { method: "POST", body: { credential, link: googleLink } });
  if (!r.ok) return toast(r.data.error || "Google sign-in failed. Try again.");
  signedIn(r.data.user);
}

// Fills a container with a button for each sign-in option the site has turned on.
// With link, the options connect to the signed-in account instead (skipping `exclude`).
export async function renderSignInOptions(container, { link = false, exclude = [] } = {}) {
  const { googleClientId, signIn = [] } = await config;
  const options = signIn.filter(p => !exclude.includes(p));
  if (!options.length) {
    container.innerHTML = link ? `<p class="hint">Every sign-in option is already connected.</p>` : `<p class="error">Sign-in isn't available yet. Try again later.</p>`;
    return;
  }
  const back = encodeURIComponent(link ? "/account" : location.pathname + location.search + location.hash);
  container.innerHTML = options.map(p => {
    if (p === "google") return `<div class="gsi" data-gsi></div>`;
    if (p === "whatsapp") return `
      <button class="sso sso-whatsapp" type="button" data-wa-open>${link ? "Connect" : "Continue with"} WhatsApp</button>
      <form class="wa-form" data-wa-phone hidden>
        <label>Your WhatsApp number<input type="tel" name="phone" autocomplete="tel" placeholder="+44 7700 900123" required></label>
        <button class="btn btn-buy" type="submit">Send code</button>
      </form>
      <form class="wa-form" data-wa-code hidden>
        <p class="small">Enter the 6-digit code WhatsApp sent to <strong data-wa-to></strong>.</p>
        <label>Code<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>
        <div class="wa-actions"><button class="btn btn-buy" type="submit">${link ? "Connect" : "Sign in"}</button>
        <button class="link-btn" type="button" data-wa-back>Use a different number</button></div>
      </form>`;
    const info = PROVIDERS[p];
    return `<a class="sso sso-${p}" href="/api/auth/${p}/start?return=${back}${link ? "&link=1" : ""}" data-oauth>${info.logo}${link ? "Connect" : "Sign in with"} ${info.name}</a>`;
  }).join("");

  // Remember what the person was doing, since these options leave the page.
  container.querySelectorAll("[data-oauth]").forEach(a => a.addEventListener("click", () => {
    try { if (pendingResume) sessionStorage.setItem(RESUME, JSON.stringify({ ...pendingResume, at: Date.now() })); } catch {}
  }));

  const gsi = container.querySelector("[data-gsi]");
  if (gsi) {
    googleLink = link;
    try {
      await loadGis(googleClientId);
      google.accounts.id.renderButton(gsi, { theme: "outline", size: "large", text: link ? "continue_with" : "signin_with", shape: "rectangular", width: 300 });
    } catch {
      gsi.innerHTML = `<p class="error">Google sign-in couldn't load. If you use a content blocker, allow accounts.google.com.</p>`;
    }
  }

  const open = container.querySelector("[data-wa-open]");
  if (open) {
    const phoneForm = container.querySelector("[data-wa-phone]");
    const codeForm = container.querySelector("[data-wa-code]");
    let phone = "";
    open.addEventListener("click", () => { open.hidden = true; phoneForm.hidden = false; phoneForm.phone.focus(); });
    phoneForm.addEventListener("submit", async e => {
      e.preventDefault();
      phone = phoneForm.phone.value.trim();
      const btn = phoneForm.querySelector("button"); btn.disabled = true;
      const r = await api("/api/auth/whatsapp/start", { method: "POST", body: { phone } });
      btn.disabled = false;
      if (!r.ok) return toast(r.data.error);
      container.querySelector("[data-wa-to]").textContent = phone;
      phoneForm.hidden = true; codeForm.hidden = false; codeForm.code.focus();
    });
    codeForm.addEventListener("submit", async e => {
      e.preventDefault();
      const r = await api("/api/auth/whatsapp/verify", { method: "POST", body: { phone, code: codeForm.code.value, link } });
      if (!r.ok) return toast(r.data.error);
      signedIn(r.data.user, link ? "link" : "whatsapp");
    });
    container.querySelector("[data-wa-back]").addEventListener("click", () => {
      codeForm.hidden = true; phoneForm.hidden = false; codeForm.code.value = ""; phoneForm.phone.focus();
    });
  }
}

export async function openSignIn(afterSignIn = null, resume = null) {
  pendingAction = afterSignIn;
  pendingResume = resume;
  const d = dialog();
  if (!d.open) d.showModal();
  await renderSignInOptions($("signin-options"));
}

// Runs the action now if signed in, otherwise after the person signs in. `resume`
// describes the action so it can continue after a sign-in that leaves the page.
export async function requireSignIn(action, resume = null) {
  await ready;
  if (currentUser) return action();
  openSignIn(action, resume);
}

let catalogPromise;
export const getCatalog = () => catalogPromise ??= api("/api/catalog").then(r => (r.ok ? r.data : {}));

// Actions waiting for a brand-new account to answer the birthday question.
let afterBirthday = null;

export function checkout(product, button) {
  if (paymentsOff) return comingSoon();
  return requireSignIn(async () => {
    if (!currentUser.ageGroup) { afterBirthday = () => checkout(product, button); return openBirthday(); }
    const item = (await getCatalog())[product];
    if (item?.adultOnly && currentUser.ageGroup !== "adult") {
      return openAgeConfirm(`Confirm you're an adult to buy a ${item.name.toLowerCase()}.`);
    }
    let how = "card";
    if (item?.walletPayable && (currentUser.wallet ?? 0) >= item.price) {
      how = await choosePayment(item);
      if (!how) return;
    }
    if (button) button.disabled = true;
    const r = await api(how === "wallet" ? "/api/wallet/pay" : "/api/checkout", { method: "POST", body: { product } });
    if (button) button.disabled = false;
    if (how === "wallet" && r.ok) { location.href = `/account?order=${r.data.orderId}&paid=wallet`; return; }
    if (r.data.url) location.href = r.data.url;
    else if (r.data.needs === "adult") openAgeConfirm(r.data.error);
    else if (r.data.needs !== "birthday") toast(r.data.error || "Checkout couldn't start. Try again in a moment.");
  }, { buy: product });
}

// ---------- Orbs ----------
// Short counts for the small stack in the header: 950, 2,500, 12.5k, 200k.
const shortCount = n => {
  const a = Math.abs(n), sign = n < 0 ? "−" : "";
  if (a < 10_000) return sign + a.toLocaleString("en-US");
  return sign + (Math.floor(a / 100) / 10).toLocaleString("en-US", { maximumFractionDigits: a < 100_000 ? 1 : 0 }) + "k";
};
// The orb balance drawn as a Minecraft item stack: an XP orb in a slot, the count on top.
export function stack(count, { big = false } = {}) {
  const label = big ? (count < 0 ? "−" : "") + Math.abs(count).toLocaleString("en-US") : shortCount(count);
  return `<span class="stack${big ? " stack-big" : ""}"><span class="stack-gem">${icon("orb")}</span><span class="stack-count">${label}</span></span>`;
}

function choosePayment(item) {
  const left = currentUser.wallet - item.price;
  document.body.insertAdjacentHTML("beforeend", `
    <dialog class="panel gate" id="pay-dialog" aria-labelledby="pay-title">
      <h2 id="pay-title">Pay for ${esc(item.name.toLowerCase())}</h2>
      <div class="choices">
        <button class="choice" type="button" value="wallet"><span class="slot">${icon("orb")}</span>
          <span><strong>Pay with orbs: ${orbs(item.price)}</strong><span class="small">You'd have ${orbs(left)} left.</span></span></button>
        <button class="choice" type="button" value="card"><span class="slot">${icon("card")}</span>
          <span><strong>Pay by card: ${money(item.price)}</strong><span class="small">Card, bank or wallet apps through Stripe Checkout.</span></span></button>
      </div>
      <button class="btn" type="button" value="">Cancel</button>
    </dialog>`);
  const d = $("pay-dialog");
  return new Promise(resolve => {
    d.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (b) d.close(b.value);
    });
    d.addEventListener("close", () => { resolve(d.returnValue || null); d.remove(); });
    d.showModal();
  });
}

// ---------- Age (like Discord: everyone starts as a teen; adults confirm) ----------
const MONTHS = [...Array(12)].map((_, i) => new Date(Date.UTC(2000, i, 1)).toLocaleString(undefined, { month: "long", timeZone: "UTC" }));

function birthdayDialog() {
  const year = new Date().getFullYear();
  document.body.insertAdjacentHTML("beforeend", `
    <dialog class="panel gate" id="birthday-dialog" aria-labelledby="birthday-title">
      <h2 id="birthday-title">When's your birthday?</h2>
      <p>Everyone answers this once. It keeps ForgeCenter right for younger players. Only your age group is saved, not the date.</p>
      <form class="birthday-form" id="birthday-form">
        <label>Month<select name="month" required><option value="" disabled selected hidden>Choose</option>${MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("")}</select></label>
        <label>Day<select name="day" required><option value="" disabled selected hidden>Choose</option>${[...Array(31)].map((_, i) => `<option>${i + 1}</option>`).join("")}</select></label>
        <label>Year<select name="year" required><option value="" disabled selected hidden>Choose</option>${[...Array(101)].map((_, i) => `<option>${year - i}</option>`).join("")}</select></label>
        <label class="check-row terms-row"><input type="checkbox" name="terms" required> I agree to the <a href="/terms" target="_blank">terms of service</a> and <a href="/privacy" target="_blank">privacy policy</a></label>
        <p class="error" id="birthday-error" role="alert" hidden></p>
        <button class="btn btn-buy" type="submit">Continue</button>
      </form>
      <p class="small">Signed in with the wrong account? <button class="link-btn" type="button" id="birthday-signout">Sign out</button></p>
    </dialog>`);
  const d = $("birthday-dialog");
  d.addEventListener("cancel", e => e.preventDefault()); // it has to be answered
  $("birthday-signout").addEventListener("click", async () => { d.close(); await signOut(); });
  $("birthday-form").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target.elements;
    const r = await api("/api/me/birthday", { method: "POST", body: { year: Number(f.year.value), month: Number(f.month.value), day: Number(f.day.value), acceptTerms: f.terms.checked } });
    if (r.ok) {
      d.close(); setUser(r.data.user);
      const next = afterBirthday; afterBirthday = null;
      next?.();
      return;
    }
    if (r.data.needs === "closed" || r.data.needs === "blocked") { d.close(); setUser(null); openClosed(r.data.error); return; }
    $("birthday-error").textContent = r.data.error;
    $("birthday-error").hidden = false;
  });
  return d;
}

export function openBirthday() {
  const d = $("birthday-dialog") ?? birthdayDialog();
  if (!d.open) d.showModal();
}

function openClosed(message = "This account is closed because ForgeCenter accounts are for people 13 and older.") {
  if ($("closed-dialog")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <dialog class="panel gate" id="closed-dialog" aria-labelledby="closed-title">
      <span class="gate-icon">${icon("barrier")}</span>
      <h2 id="closed-title">ForgeCenter accounts are for ages 13 and up</h2>
      <p>${esc(message)}</p>
      <a class="btn" href="/" id="closed-ok">Back to the home page</a>
    </dialog>`);
  $("closed-ok").addEventListener("click", async e => {
    if (!currentUser) return;
    e.preventDefault();
    await signOut();
    location.href = "/";
  });
  $("closed-dialog").addEventListener("cancel", e => e.preventDefault());
  $("closed-dialog").showModal();
}

// ---------- Suspended accounts (src/reports.js) ----------
// Blocks the page, except where the person reads the rules or appeals.
const APPEAL_PAGES = ["/support", "/rules", "/terms", "/privacy"];
function openSuspended(reason) {
  if (APPEAL_PAGES.includes(location.pathname.replace(/\.html$/, ""))) {
    if (location.pathname.startsWith("/support")) toast("Your account is suspended. Open a ticket here to appeal.");
    return;
  }
  if ($("suspended-dialog")) { if (!$("suspended-dialog").open) $("suspended-dialog").showModal(); return; }
  document.body.insertAdjacentHTML("beforeend", `
    <dialog class="panel gate" id="suspended-dialog" aria-labelledby="suspended-title">
      <span class="gate-icon">${icon("barrier")}</span>
      <h2 id="suspended-title">Your account is suspended</h2>
      <p>The ForgeCenter team suspended this account because it broke the <a href="/rules">ForgeCenter rules</a>. While it's suspended you can't buy, post or use the signed-in tools.</p>
      ${reason ? `<p class="note"><strong>Reason:</strong> ${esc(reason)}</p>` : ""}
      <p>Think it's a mistake? Open a support ticket to appeal, and a person will look at it again.${currentUser?.hasBilling ? " You can still cancel monthly plans, game launches and donations in Manage billing." : ""}</p>
      <div class="ticket-actions">
        <a class="btn btn-buy" href="/support" autofocus>Appeal on the Help page</a>
        ${currentUser?.hasBilling ? `<button class="btn" type="button" id="suspended-billing">Manage billing</button>` : ""}
        <button class="btn" type="button" id="suspended-signout">Sign out</button>
      </div>
    </dialog>`);
  const d = $("suspended-dialog");
  // Nothing else works until it's resolved. Browsers let a second Escape close a dialog
  // even when cancel is prevented, so it opens again; only signing out removes it.
  d.addEventListener("cancel", e => e.preventDefault());
  d.addEventListener("close", () => { if (d.isConnected) d.showModal(); });
  $("suspended-signout").addEventListener("click", async () => { await signOut(); d.remove(); });
  $("suspended-billing")?.addEventListener("click", async e => {
    e.target.disabled = true;
    const r = await api("/api/billing-portal", { method: "POST" });
    e.target.disabled = false;
    if (r.data.url) location.href = r.data.url; else toast(r.data.error);
  });
  d.showModal();
}

// What confirming unlocks, from the catalog's adult-only products.
const PLURAL = { website: "websites", game: "games", roblox: "Roblox games", launcher: "launchers", discord: "Discord bots", mcserver: "server hosting", ai: "AI assistants", showcase: "showcase slots" };
export async function adultPerks() {
  const items = Object.entries(await getCatalog()).filter(([, i]) => i.adultOnly).map(([k, i]) => PLURAL[k] ?? i.name);
  const buy = items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items[0];
  return buy ? `buy ${buy} and see 18+ showcase listings` : "see 18+ showcase listings";
}

function ageDialog() {
  document.body.insertAdjacentHTML("beforeend", `
    <dialog class="panel gate age-dialog" id="age-dialog" aria-labelledby="age-title">
      <span class="gate-icon">${icon("idcard")}</span>
      <h2 id="age-title">Confirm your age group</h2>
      <p id="age-reason"></p>
      <div class="choices">
        <button class="choice" type="button" data-age-method="card"><span class="slot">${icon("card")}</span>
          <span><strong>Credit card</strong><span class="small">ForgeCenter never sees your card details, and you aren't charged. Your bank may show a small temporary hold that disappears on its own.</span>
          <span class="small provider">Provided by Stripe</span></span></button>
        <button class="choice" type="button" data-age-method="id"><span class="slot">${icon("idcard")}</span>
          <span><strong>ID scan</strong><span class="small">Scan a photo ID and take a selfie to show it's yours. ForgeCenter only learns whether you're 18 or over, and asks Stripe to delete both straight after.</span>
          <span class="small provider">Provided by Stripe Identity</span></span></button>
      </div>
      <p class="error" id="age-error" role="alert" hidden></p>
      <button class="btn" type="button" id="age-close">Not now</button>
    </dialog>`);
  const d = $("age-dialog");
  $("age-close").addEventListener("click", () => d.close());
  d.querySelectorAll("[data-age-method]").forEach(b => b.addEventListener("click", async () => {
    b.disabled = true;
    const r = await api(`/api/age/${b.dataset.ageMethod}`, { method: "POST" });
    b.disabled = false;
    if (r.data.url) { location.href = r.data.url; return; }
    $("age-error").textContent = r.data.error || "The check couldn't start. Try again in a moment.";
    $("age-error").hidden = false;
  }));
  return d;
}

export function openAgeConfirm(reason = null) {
  return requireSignIn(async () => {
    if (!currentUser.ageGroup) { afterBirthday = () => openAgeConfirm(reason); return openBirthday(); }
    if (currentUser.ageGroup === "adult") return toast("Your age is already confirmed.");
    const d = $("age-dialog") ?? ageDialog();
    $("age-reason").textContent = reason ?? `Confirmed adults can ${await adultPerks()}. ForgeCenter keeps only the result.`;
    $("age-error").hidden = true;
    if (!d.open) d.showModal();
  });
}

// Any [data-buy] button on any page starts checkout, and [data-confirm-age] opens the age check.
document.addEventListener("click", e => {
  const btn = e.target.closest("[data-buy]");
  if (btn) checkout(btn.dataset.buy, btn);
  if (e.target.closest("[data-confirm-age]")) openAgeConfirm();
});

// Messages and unfinished actions from a sign-in that left the page.
{
  const params = new URLSearchParams(location.search);
  const error = params.get("auth_error");
  const connected = params.get("connected");
  if (error) toast(AUTH_ERRORS[error] ?? AUTH_ERRORS.failed);
  if (connected && PROVIDER_NAMES[connected]) toast(`${PROVIDER_NAMES[connected]} is connected. You can sign in with it now.`);
  if (error || connected) {
    params.delete("auth_error"); params.delete("connected");
    history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "") + location.hash);
  }
  ready.then(() => {
    let resume = null;
    try { resume = JSON.parse(sessionStorage.getItem(RESUME) || "null"); sessionStorage.removeItem(RESUME); } catch {}
    if (currentUser && !error && resume?.buy && Date.now() - resume.at < 10 * 60_000) checkout(resume.buy);
  });
}

// ---------- Creator referral links (?ref=handle) ----------
// Remembered until the tab closes, and sent once after sign-in. The server decides whether it
// counts (new accounts without orders only).
{
  const REF = "fc-ref";
  const params = new URLSearchParams(location.search);
  const code = params.get("ref");
  if (code !== null) {
    if (/^[a-z0-9-]{3,24}$/i.test(code)) {
      try { sessionStorage.setItem(REF, JSON.stringify({ code: code.toLowerCase(), at: Date.now() })); } catch {}
    }
    params.delete("ref");
    history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "") + location.hash);
  }
  onUser(async user => {
    if (!user?.ageGroup || user.ageGroup === "under13") return;
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(REF) || "null"); sessionStorage.removeItem(REF); } catch {}
    if (!saved?.code || !(Date.now() - saved.at < 30 * 24 * 60 * 60 * 1000)) return;
    const r = await api("/api/creators/referral/claim", { method: "POST", body: { code: saved.code } });
    if (r.ok) toast(`Welcome! You joined through a link from @${r.data.creator.handle}.`);
  });
}

// ---------- Cookie notice ----------
// ForgeCenter only stores what it needs to work (the sign-in cookie, and a creator's
// referral link until you sign in during the same visit), so there's nothing optional
// to accept or reject: the notice just says so, once.
const NOTICE = "fc-cookies";
export function cookieChoice() { try { return localStorage.getItem("fc-cookies"); } catch { return null; } }
function cookieNotice() {
  if (cookieChoice()) return;
  const bar = document.createElement("div");
  bar.className = "cookie-bar panel";
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Cookie notice");
  bar.innerHTML = `<p>ForgeCenter only uses the cookies it needs to work, like the one that keeps you signed in. No ads, no tracking. <a href="/privacy#cookies">Details</a></p>
    <div class="cookie-actions"><button class="btn btn-buy" type="button">Got it</button></div>`;
  bar.querySelector("button").addEventListener("click", () => {
    try { localStorage.setItem(NOTICE, "seen"); } catch {}
    bar.remove();
  });
  document.body.append(bar);
}
cookieNotice();

// ---------- Light and dark mode ----------
{
  const slot = document.getElementById("auth-slot");
  if (slot) {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "theme-btn";
    const label = () => {
      const light = document.documentElement.dataset.theme === "light";
      btn.textContent = light ? "☾" : "☀";
      btn.setAttribute("aria-label", light ? "Switch to dark mode" : "Switch to light mode");
      btn.title = btn.getAttribute("aria-label");
    };
    btn.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("fc-theme", next); } catch {}
      label();
    });
    label();
    slot.before(btn);
  }
}

// ---------- Tools menu in the header: every tool one click away ----------
{
  const link = document.querySelector('.top nav a[href$="#tools"]');
  if (link) {
    const TOOLS = [
      ["⛏", "Mod Forge", "Start a Fabric mod", "/#forge"],
      ["🎨", "Texture Forge", "Draw or import textures", "/textures"],
      ["📦", "Modpack Forge", "Fabric, NeoForge, Forge, Quilt", "/modpacks"],
      ["🔌", "Plugin Forge", "Paper server plugins", "/plugins"],
      ["🎮", "Roblox Forge", "Scripts for Roblox Studio", "/roblox"],
      ["🤖", "AI Maker", "Your own AI helper", "/ai-maker"],
      ["🌐", "Site Maker", "One-page websites", "/site-maker"],
    ];
    const menu = document.createElement("details");
    menu.className = "nav-tools";
    menu.innerHTML = `<summary>Free tools</summary><div class="nav-menu">${TOOLS.map(([i, n, d, h]) =>
      `<a href="${h}"><span class="ni" aria-hidden="true">${i}</span><b>${n}</b><small>${d}</small></a>`).join("")}</div>`;
    link.replaceWith(menu);
    document.addEventListener("click", e => { if (!menu.contains(e.target)) menu.open = false; });
    document.addEventListener("keydown", e => { if (e.key === "Escape") menu.open = false; });
  }
  // Mark the current page in the menu.
  document.querySelectorAll(".top nav a").forEach(a => { if (a.pathname === location.pathname && a.pathname !== "/") a.setAttribute("aria-current", "page"); });
}

// ---------- Payments not switched on yet ----------
// Before Stripe is set up, anything that costs money says "Coming soon" instead of
// erroring. Free tools, sign-in and everything else work as normal.
let paymentsOff = false;
export const paymentsOn = () => !paymentsOff;
function comingSoon() {
  toast("Buying opens soon. Everything free on ForgeCenter works right now.");
}
config.then(c => {
  if (c?.payments !== false) return;
  paymentsOff = true;
  document.documentElement.classList.add("payments-off");
  const mark = root => root.querySelectorAll("[data-buy], .pc-buy, .donate-btn, [data-pack], [data-orb-buy], [data-pack-jump], #topup-custom-btn").forEach(b => {
    if (b.dataset.soon) return;
    b.dataset.soon = "1"; b.textContent = "Coming soon"; b.disabled = true; b.classList.remove("btn-buy");
  });
  mark(document);
  new MutationObserver(() => mark(document)).observe(document.body, { childList: true, subtree: true });
  if (!document.querySelector(".soon-bar")) {
    const bar = document.createElement("div");
    bar.className = "soon-bar";
    bar.innerHTML = `<b>Shop opening soon.</b> All the free tools work right now. <a href="/#tools">Try them</a>`;
    document.querySelector(".top")?.after(bar);
  }
});
