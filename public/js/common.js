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

// ---------- Google sign-in dialog ----------
let pendingAction = null;
let gis;

function dialog() {
  let d = $("signin-dialog");
  if (d) return d;
  document.body.insertAdjacentHTML("beforeend", `
    <dialog class="panel signin" id="signin-dialog" aria-labelledby="signin-title">
      <h2 id="signin-title">Sign in to ForgeCenter</h2>
      <p>Use your Google account. ForgeCenter only receives your name, email address and profile picture.</p>
      <div id="gsi-button" class="gsi"></div>
      <p class="small" id="signin-note">By signing in you agree to the <a href="/terms">terms</a> and the <a href="/privacy">privacy policy</a>.</p>
      <button class="btn" type="button" id="signin-close">Not now</button>
    </dialog>`);
  d = $("signin-dialog");
  $("signin-close").addEventListener("click", () => { pendingAction = null; d.close(); });
  d.addEventListener("cancel", () => { pendingAction = null; });
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

async function onCredential({ credential }) {
  const r = await api("/api/auth/google", { method: "POST", body: { credential } });
  if (!r.ok) return toast(r.data.error || "Google sign-in failed. Try again.");
  dialog().close();
  setUser(r.data.user);
  toast(`Signed in as ${r.data.user.email}.`);
  const action = pendingAction; pendingAction = null;
  action?.();
}

export async function openSignIn(afterSignIn = null) {
  pendingAction = afterSignIn;
  const d = dialog();
  if (!d.open) d.showModal();
  const { googleClientId } = await config;
  const target = $("gsi-button");
  if (!googleClientId) { target.innerHTML = `<p class="error">Sign-in isn't available yet. Try again later.</p>`; return; }
  try {
    await loadGis(googleClientId);
    target.innerHTML = "";
    google.accounts.id.renderButton(target, { theme: "outline", size: "large", text: "signin_with", shape: "rectangular", width: 280 });
  } catch {
    target.innerHTML = `<p class="error">Google sign-in couldn't load. If you use a content blocker, allow accounts.google.com and try again.</p>`;
  }
}

// Runs the action now if signed in, otherwise after the person signs in.
export async function requireSignIn(action) {
  await ready;
  if (currentUser) return action();
  openSignIn(action);
}

export function checkout(product, button) {
  return requireSignIn(async () => {
    if (button) button.disabled = true;
    const r = await api("/api/checkout", { method: "POST", body: { product } });
    if (button) button.disabled = false;
    if (r.data.url) location.href = r.data.url;
    else toast(r.data.error || "Checkout couldn't start. Try again in a moment.");
  });
}

// Any [data-buy] button on any page starts checkout.
document.addEventListener("click", e => {
  const btn = e.target.closest("[data-buy]");
  if (btn) checkout(btn.dataset.buy, btn);
});
