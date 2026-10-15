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
};

export function icon(name, label = "") {
  const { c, m } = ICONS[name];
  let rects = "";
  m.forEach((row, y) => [...row].forEach((ch, x) => {
    if (c[ch]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c[ch]}"/>`;
  }));
  const a11y = label ? `role="img" aria-label="${label}"` : `aria-hidden="true"`;
  return `<svg class="px" viewBox="0 0 8 8" shape-rendering="crispEdges" ${a11y}>${rects}</svg>`;
}

export const PRODUCT_ICON = { website: "monitor", mcserver: "grass", discord: "bot", game: "diamond", ai: "eye", showcase: "frame" };

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
  listeners.forEach(fn => fn(user));
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

export function checkout(product, button) {
  return requireSignIn(async () => {
    if (button) button.disabled = true;
    const r = await api("/api/checkout", { method: "POST", body: { product } });
    if (button) button.disabled = false;
    if (r.data.url) location.href = r.data.url;
    else toast(r.data.error || "Checkout couldn't start. Try again in a moment.");
  }, { buy: product });
}

// Any [data-buy] button on any page starts checkout.
document.addEventListener("click", e => {
  const btn = e.target.closest("[data-buy]");
  if (btn) checkout(btn.dataset.buy, btn);
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
