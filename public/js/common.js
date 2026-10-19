// Shared by every page: API calls, the header, sign-in, first-time setup (birthday and
// username), the cookie notice, the theme switch and the report dialog.
export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const money = cents => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
export const size = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
export const ago = iso => {
  const s = (Date.now() - new Date(iso)) / 1000;
  for (const [n, u] of [[31536000, "year"], [2592000, "month"], [86400, "day"], [3600, "hour"], [60, "minute"]]) {
    if (s >= n) { const v = Math.floor(s / n); return `${v} ${u}${v > 1 ? "s" : ""} ago`; }
  }
  return "just now";
};

export async function api(path, { method = "GET", body, raw } = {}) {
  const init = { method, headers: {} };
  if (raw !== undefined) { init.body = raw; init.headers["Content-Type"] = "application/octet-stream"; }
  else if (body !== undefined || method !== "GET") { init.body = JSON.stringify(body ?? {}); init.headers["Content-Type"] = "application/json"; }
  try {
    const r = await fetch(path, init);
    const data = await r.json().catch(() => ({}));
    if (!r.ok && data.needs && data.needs !== "closed") setup(data.needs);
    return { ok: r.ok, status: r.status, data };
  } catch { return { ok: false, status: 0, data: { error: "You seem to be offline. Check your connection and try again." } }; }
}

let toastTimer;
export function toast(text) {
  let t = $("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}

// ---------- Current user ----------
let user = null, config = { signIn: [], payments: false };
const waiting = [];
export const getUser = () => user;
export const getConfig = () => config;
export const onUser = fn => { waiting.push(fn); if (ready) fn(user); };
let ready = false;
async function loadMe() {
  const [me, cfg] = await Promise.all([api("/api/me"), api("/api/config")]);
  user = me.data.user ?? null; config = cfg.data ?? config; ready = true;
  renderHeader();
  if (user && !user.ageGroup) setup("birthday"); else if (user && !user.username) setup("username");
  waiting.forEach(fn => fn(user));
}
export async function refreshUser() { user = (await api("/api/me")).data.user ?? null; renderHeader(); return user; }

function renderHeader() {
  const slot = $("auth-slot");
  if (!slot) return;
  if (!user) {
    slot.innerHTML = `<button class="btn btn-small btn-primary" type="button" id="signin-btn">Sign in</button>`;
    $("signin-btn").onclick = () => openSignIn();
  } else {
    const pic = user.picture ? `<img class="avatar" src="${esc(user.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar" aria-hidden="true"></span>`;
    slot.innerHTML = `${user.isAdmin ? `<a class="btn btn-small" href="/admin">Owner</a>` : ""}
      <a class="btn btn-small" href="/new">+ New</a>
      <a class="me-link" href="/${esc(user.username ?? "settings")}" title="Your profile">${pic}<span class="sr-only">Your profile</span></a>`;
  }
  if (!config.payments && !document.querySelector(".soon") && /^\/(store|library)/.test(location.pathname)) {
    document.querySelector(".top")?.insertAdjacentHTML("afterend", `<div class="soon">Payments open soon. Repos, live sites and Forge AI all work now.</div>`);
  }
}

// ---------- Dialogs ----------
function dialog(html) {
  const d = document.createElement("dialog");
  d.innerHTML = html;
  document.body.append(d);
  d.addEventListener("close", () => d.remove());
  d.showModal();
  return d;
}
const PROVIDER = { github: "GitHub", discord: "Discord", microsoft: "Microsoft" };
export function openSignIn() {
  const ret = encodeURIComponent(location.pathname + location.search);
  const buttons = config.signIn.map(p => `<a class="btn" href="/api/auth/${p}/start?return=${ret}">Continue with ${PROVIDER[p] ?? p}</a>`).join("");
  const d = dialog(`<h2>Sign in to Forgehub</h2>
    <p class="muted">Use an account you already have. No passwords to remember.</p>
    <div class="form">${buttons || `<p class="hint">Sign-in isn't set up on this server yet.</p>`}
    ${config.devLogin ? `<form id="dev-form" class="row"><input name="name" placeholder="Test name" required><button class="btn">Dev sign-in</button></form>` : ""}</div>
    <p class="small">By signing in you agree to the <a href="/terms">terms</a> and <a href="/privacy">privacy policy</a>.</p>
    <form method="dialog"><button class="btn btn-small">Close</button></form>`);
  d.querySelector("#dev-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const r = await api("/api/auth/dev", { method: "POST", body: { name: e.target.elements.name.value } });
    if (r.ok) location.reload(); else toast(r.data.error);
  });
}

let setupOpen = false;
function setup(step) {
  if (setupOpen) return;
  if (step === "suspended") return toast("Your account is suspended. Email support to appeal.");
  setupOpen = true;
  if (step === "birthday") {
    const d = dialog(`<h2>Welcome to Forgehub</h2>
      <form class="form" id="bday"><p class="muted">When's your birthday? We only keep your age group, never the date.</p>
      <label>Date of birth<input type="date" name="dob" required max="${new Date().toISOString().slice(0, 10)}"></label>
      <label class="check"><input type="checkbox" name="terms" required> I agree to the <a href="/terms" target="_blank">terms of service</a> and <a href="/privacy" target="_blank">privacy policy</a>.</label>
      <button class="btn btn-primary">Continue</button></form>`);
    d.addEventListener("cancel", e => e.preventDefault());
    d.querySelector("#bday").addEventListener("submit", async e => {
      e.preventDefault();
      const [year, month, day] = e.target.dob.value.split("-").map(Number);
      const r = await api("/api/me/birthday", { method: "POST", body: { year, month, day, acceptTerms: e.target.terms.checked } });
      if (!r.ok) { toast(r.data.error); if (r.data.needs === "closed") setTimeout(() => location.assign("/"), 2500); return; }
      user = r.data.user; d.close(); setupOpen = false; setup("username");
    });
  } else if (step === "username") {
    const d = dialog(`<h2>Pick a username</h2>
      <form class="form" id="uname"><p class="muted">It's your address on Forgehub, like forgehub/<b id="u-preview">you</b>. You can change it later.</p>
      <label>Username<input name="username" required minlength="2" maxlength="39" autocomplete="username" pattern="[a-z0-9\\-]+" placeholder="steve"></label>
      <button class="btn btn-primary">Save</button></form>`);
    d.addEventListener("cancel", e => e.preventDefault());
    const input = d.querySelector("input");
    input.value = (user?.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 39);
    input.oninput = () => { input.value = input.value.toLowerCase(); d.querySelector("#u-preview").textContent = input.value || "you"; };
    d.querySelector("#uname").addEventListener("submit", async e => {
      e.preventDefault();
      const r = await api("/api/me/username", { method: "POST", body: { username: input.value } });
      if (!r.ok) return toast(r.data.error);
      user = r.data.user; d.close(); setupOpen = false; renderHeader(); toast(`Welcome, @${user.username}!`);
    });
  } else setupOpen = false;
}

export function openReport(type, target) {
  if (!user) return openSignIn();
  const d = dialog(`<h2>Report this</h2><form class="form" id="rep">
    <label>What's wrong?<select name="reason" required>
      <option value="scam">Scam or fraud</option><option value="malware">Malware or a harmful file</option>
      <option value="stolen">Stolen or copied work</option><option value="game-accounts">Selling game accounts or currency</option>
      <option value="adult">Adult or unsafe content</option><option value="hate">Hate or harassment</option>
      <option value="spam">Spam</option><option value="other">Something else</option></select></label>
    <label>Details (optional)<textarea name="details" maxlength="1000"></textarea></label>
    <div class="row"><button class="btn btn-primary">Send report</button><button class="btn" value="cancel" formmethod="dialog">Cancel</button></div></form>`);
  d.querySelector("#rep").addEventListener("submit", async e => {
    if (e.submitter?.value === "cancel") return;
    e.preventDefault();
    const r = await api("/api/reports", { method: "POST", body: { type, target, reason: e.target.reason.value, details: e.target.details.value } });
    d.close(); toast(r.ok ? "Thanks. The team will take a look." : r.data.error);
  });
}

export async function signOut() { await api("/api/auth/logout", { method: "POST" }); location.assign("/"); }

// ---------- Cookie notice: only essential cookies exist, so both buttons just close it ----------
function cookieNotice() {
  try { if (localStorage.getItem("fh-cookies")) return; } catch { return; }
  document.body.insertAdjacentHTML("beforeend", `<div class="cookie" id="cookie" role="region" aria-label="Cookies">
    <p class="small" style="margin:0 0 10px">Forgehub only uses the cookies it needs to keep you signed in. No ads, no tracking. <a href="/privacy#cookies">Learn more</a></p>
    <div class="row"><button class="btn btn-small btn-primary" data-c="accept">Accept</button><button class="btn btn-small" data-c="reject">Reject optional cookies</button></div></div>`);
  $("cookie").addEventListener("click", e => {
    const c = e.target.dataset.c;
    if (!c) return;
    try { localStorage.setItem("fh-cookies", c); } catch {}
    $("cookie").remove();
  });
}

function themeButton() {
  const b = $("theme-btn");
  if (!b) return;
  const sync = () => { const light = document.documentElement.dataset.theme === "light"; b.textContent = light ? "☾" : "☀"; b.setAttribute("aria-label", light ? "Switch to dark mode" : "Switch to light mode"); };
  sync();
  b.onclick = () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("fh-theme", next); } catch {}
    sync();
  };
}

document.querySelectorAll(".top nav a").forEach(a => { if (a.getAttribute("href") === location.pathname) a.setAttribute("aria-current", "page"); });
const err = new URLSearchParams(location.search).get("auth_error");
if (err) toast({ denied: "Sign-in was cancelled.", expired: "That sign-in link expired. Try again.", failed: "Sign-in didn't work. Try again." }[err] ?? "Sign-in didn't work.");
themeButton();
cookieNotice();
loadMe();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
