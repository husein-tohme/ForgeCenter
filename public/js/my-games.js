// My games: a creator's game pages, the editor, and launching, cancelling and resuming.
import { $, api, esc, date, toast, onUser, ready, getUser, openSignIn, openAgeConfirm } from "./common.js";
import { getOptions, gameCard, gameIcon, accentClass, statusPill, statusInfo, confirmDialog } from "./launchpad.js";

const ICON_NAMES = { gamepad: "Gamepad", sword: "Sword", trophy: "Trophy", potion: "Potion", heart: "Heart", star: "Star",
  castle: "Castle", map: "Map", slime: "Slime", tnt: "TNT", diamond: "Diamond", grass: "Grass block", pickaxe: "Pickaxe",
  chest: "Chest", rocket: "Rocket", portal: "Portal" };
// What the play link is for, by platform.
const URL_HINT = {
  "minecraft-server": "Your server's website or Discord, if it has one.",
  "minecraft-map": "Where people download it, like Modrinth, CurseForge or Planet Minecraft.",
  "minecraft-mod": "Where people download it, like Modrinth or CurseForge.",
  roblox: "Your game's page on Roblox.",
  web: "Where people play it in their browser.",
  steam: "Your game's Steam store page.",
  itch: "Your game's itch.io page.",
};

const params = new URLSearchParams(location.search);
const launchedId = Number(params.get("launched")) || null;
let editWanted = Number(params.get("edit")) || null;
if (launchedId) toast("Payment received. Your game goes live in a moment.");
// Read once; drop them so a reload doesn't repeat the message.
params.delete("launched"); params.delete("edit");
history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : ""));

const opts = await getOptions();
const form = $("game-form");
const f = form.elements;
let games = [], limit = 10, canMarkAdult = false;
let editing = null; // the game being edited, or null for a new one

$("signin-here").addEventListener("click", () => openSignIn());
$("new-game").addEventListener("click", () => openEditor(null));
$("close-editor").addEventListener("click", closeEditor);

// ---------- The list ----------
async function load(polls = 0) {
  const r = await api("/api/games/mine");
  if (!r.ok) { $("my-list").innerHTML = `<p class="error">${esc(r.data.error || "Your games couldn't load. Refresh the page to try again.")}</p>`; return; }
  ({ games, limit, canMarkAdult } = r.data);
  renderList();
  if (editWanted) {
    const g = games.find(x => x.id === editWanted);
    editWanted = null;
    if (g) openEditor(g);
  }
  // Just back from Stripe: the webhook usually lands within a few seconds.
  const launched = polls > 0 && games.find(g => g.id === launchedId);
  if (launched && launched.live) toast(`${launched.title} is live on the games page.`);
  else if (launched) setTimeout(() => load(polls - 1), 2500);
}

const canLaunch = g => ["draft", "checkout", "ended"].includes(g.status);

function row(g) {
  const s = statusInfo(g);
  const launchNote = canLaunch(g) ? " Launch it for $1 a month. If you cancel later, it stays up until the end of the month you've paid for, and that month isn't refunded." : "";
  return `
    <article class="panel lp-row ${accentClass(g.accent)}" data-id="${g.id}">
      <span class="slot lp-icon">${gameIcon(g.icon)}</span>
      <div class="lp-row-main">
        <h3>${esc(g.title)}</h3>
        <p class="lp-row-pills">${statusPill(g)}${g.adultOnly ? ` <span class="pill pill-adult">18+</span>` : ""}</p>
        <p class="small">${esc(s.help + launchNote)}</p>
      </div>
      <div class="lp-row-actions">
        ${canLaunch(g) ? `<button class="btn btn-buy btn-small" type="button" data-act="launch">${g.status === "ended" ? "Launch again" : "Launch"} for $1/month</button>` : ""}
        ${g.status === "ending" ? `<button class="btn btn-buy btn-small" type="button" data-act="resume">Keep it live</button>` : ""}
        ${g.status === "overdue" ? `<button class="btn btn-buy btn-small" type="button" data-act="billing">Update card</button>` : ""}
        ${g.renews ? `<button class="btn btn-small" type="button" data-act="cancel">Cancel launch</button>` : ""}
        <button class="btn btn-small" type="button" data-act="edit">Edit</button>
        <a class="btn btn-small" href="/game?id=${g.id}">${g.live ? "View page" : "Preview page"}</a>
        <button class="btn btn-small btn-danger" type="button" data-act="delete">Delete</button>
      </div>
    </article>`;
}

function renderList() {
  $("game-count").textContent = `${games.length} of ${limit} games`;
  $("my-list").innerHTML = games.length ? games.map(row).join("") : `
    <div class="panel empty lp-empty"><span class="empty-icon">${gameIcon("gamepad")}</span>
      <div><p>You haven't made a game page yet. It's free until you launch it.</p>
      <button class="btn btn-buy" type="button" data-act="new">Make your first game page</button></div></div>`;
}

$("my-list").addEventListener("click", async e => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  if (b.dataset.act === "new") return openEditor(null);
  const g = games.find(x => x.id === Number(b.closest("[data-id]")?.dataset.id));
  if (!g) return;
  const act = { launch, cancel, resume, billing: openBilling, edit: () => openEditor(g), delete: remove }[b.dataset.act];
  b.disabled = true;
  try { await act(g); } finally { b.disabled = false; }
});

async function launch(g) {
  const ok = await confirmDialog({ title: `Launch ${g.title}`, iconName: "arcade", confirm: "Continue to payment", cancel: "Not now",
    bodyHtml: `<p>${esc(opts?.terms ?? "$1 a month keeps this game on the ForgeCenter games page.")}</p>
      <ul class="lp-terms-list"><li>You pay $1 today by card through Stripe, then $1 every month.</li>
      <li>Cancel any time from this page. Your game stays up until the end of the month you've paid for.</li>
      <li><strong>That month isn't refunded.</strong></li></ul>` });
  if (!ok) return;
  const r = await api(`/api/games/${g.id}/launch`, { method: "POST" });
  if (r.data.url) { location.href = r.data.url; return; }
  if (r.data.needs === "adult") return openAgeConfirm(r.data.error);
  if (r.data.needs === "billing") { toast(r.data.error); return; }
  toast(r.data.error || "Checkout couldn't start. Try again in a moment.");
  if (r.data.game) load();
}

async function cancel(g) {
  const until = g.periodEnd ? date(g.periodEnd) : null;
  const ok = await confirmDialog({ title: `Cancel the launch of ${g.title}?`, danger: true, confirm: "Cancel launch", cancel: "Keep it live",
    bodyHtml: `<p>${g.live
        ? `It stays on the games page until ${until ? `${esc(until)}, ` : ""}the end of the month you've paid for. Then it comes off and you won't be charged again.`
        : "It won't renew, so you won't be charged again."}</p>
      <p><strong>That month isn't refunded.</strong> You can switch it back on any time before it ends.</p>` });
  if (!ok) return;
  const r = await api(`/api/games/${g.id}/cancel`, { method: "POST" });
  if (!r.ok) return toast(r.data.error);
  toast(until ? `Canceled. ${g.title} stays up until ${until}.` : "Canceled. You won't be charged again.");
  load();
}

async function resume(g) {
  const ok = await confirmDialog({ title: `Keep ${g.title} live?`, confirm: "Keep it live", cancel: "Go back",
    bodyHtml: `<p>Your launch carries on${g.periodEnd ? ` and renews for $1 on ${esc(date(g.periodEnd))}` : ""}, then every month until you cancel.</p>` });
  if (!ok) return;
  const r = await api(`/api/games/${g.id}/resume`, { method: "POST" });
  if (!r.ok) return toast(r.data.error);
  toast(`${g.title} stays live.`);
  load();
}

async function remove(g) {
  const ok = await confirmDialog({ title: `Delete ${g.title}?`, danger: true, confirm: "Delete game", iconName: "tnt",
    bodyHtml: `<p>Its page is deleted for good${g.live ? " and it comes off the games page straight away" : ""}. This can't be undone.</p>
      ${g.status === "ending" ? "<p>The rest of the month you've paid for isn't refunded.</p>" : ""}` });
  if (!ok) return;
  const r = await api(`/api/games/${g.id}`, { method: "DELETE" });
  if (!r.ok) return toast(r.data.error);
  if (editing?.id === g.id) closeEditor();
  toast(`${g.title} was deleted.`);
  load();
}

async function openBilling() {
  const r = await api("/api/billing-portal", { method: "POST" });
  if (r.data.url) location.href = r.data.url; else toast(r.data.error);
}

// ---------- The editor ----------
if (opts) {
  f.platform.innerHTML = `<option value="">Choose one</option>`
    + opts.platforms.map(p => `<option value="${esc(p.key)}">${esc(p.name)}</option>`).join("");
  $("icon-picks").innerHTML = opts.icons.map(name => `
    <label class="lp-pick" title="${esc(ICON_NAMES[name] ?? name)}"><input type="radio" name="icon" value="${esc(name)}">
      <span class="slot">${gameIcon(name)}</span><span class="sr-only">${esc(ICON_NAMES[name] ?? name)}</span></label>`).join("");
  $("accent-picks").innerHTML = opts.accents.map(a => `
    <label class="lp-swatch ${accentClass(a.key)}" title="${esc(a.name)}"><input type="radio" name="accent" value="${esc(a.key)}">
      <span class="lp-swatch-color"></span><span class="sr-only">${esc(a.name)}</span></label>`).join("");
  $("tag-picks").innerHTML = opts.tags.map(t => `
    <label class="lp-tag-pick"><input type="checkbox" name="tags" value="${esc(t.key)}"><span>${esc(t.name)}</span></label>`).join("");
}

const checkedTags = () => [...form.querySelectorAll("input[name=tags]:checked")].map(i => i.value);
const setRadio = (name, value) => form.querySelectorAll(`input[name=${name}]`).forEach(i => { i.checked = i.value === value; });

// Shows the fields that fit the platform, and keeps tags to the limit.
function syncFields() {
  const server = f.platform.value === "minecraft-server";
  $("address-field").hidden = !server;
  $("url-optional").hidden = !server;
  $("url-hint").textContent = URL_HINT[f.platform.value] ?? "Where people play or download your game.";
  const full = checkedTags().length >= (opts?.limits.tags ?? 5);
  form.querySelectorAll("input[name=tags]").forEach(i => { i.disabled = full && !i.checked; });
  $("desc-count").textContent = `${f.description.value.length} of ${opts?.limits.description ?? 2000} characters`;
}

function formData() {
  return {
    title: f.title.value, tagline: f.tagline.value, platform: f.platform.value,
    serverAddress: f.platform.value === "minecraft-server" ? f.serverAddress.value : "",
    playUrl: f.playUrl.value, trailerUrl: f.trailerUrl.value, description: f.description.value,
    icon: f.icon.value || "gamepad", accent: f.accent.value || "emerald", tags: checkedTags(),
    ...($("adult-row").hidden ? {} : { adultOnly: f.adultOnly.checked }),
  };
}

function updatePreview() {
  const d = formData();
  $("preview").innerHTML = gameCard({
    ...d, title: d.title.trim(), tagline: d.tagline.trim(), serverAddress: d.serverAddress.trim(),
    // Only real links in the preview, as on the games page.
    playUrl: /^https?:\/\/\S+$/i.test(d.playUrl.trim()) ? d.playUrl.trim() : "",
    adultOnly: d.adultOnly ?? editing?.adultOnly, creator: getUser()?.name,
  }, opts, { preview: true });
}

function clearErrors() {
  form.querySelectorAll(".lp-field-error").forEach(el => el.remove());
  form.querySelectorAll("[aria-invalid]").forEach(el => el.removeAttribute("aria-invalid"));
  $("form-error").hidden = true;
}

// Puts the server's message next to the field it's about.
function showError(field, message) {
  const box = field ? form.querySelector(`[data-field="${CSS.escape(field)}"]`) : null;
  if (!box || box.hidden) {
    $("form-error").textContent = message;
    $("form-error").hidden = false;
    $("form-error").scrollIntoView({ block: "center" });
    return;
  }
  box.insertAdjacentHTML("beforeend", `<span class="error lp-field-error">${esc(message)}</span>`);
  const input = box.querySelector("input:not([disabled]), select, textarea");
  input?.setAttribute("aria-invalid", "true");
  input?.focus();
}

function openEditor(g) {
  if (!opts) return toast("The editor couldn't load. Refresh the page to try again.");
  if (!g && games.length >= limit) return toast(`You can have up to ${limit} games. Delete one you don't need to make room.`);
  editing = g;
  $("editor-title").textContent = g ? `Edit ${g.title}` : "New game";
  for (const k of ["title", "tagline", "platform", "serverAddress", "playUrl", "trailerUrl", "description"]) f[k].value = g?.[k] ?? "";
  setRadio("icon", g?.icon ?? "gamepad");
  setRadio("accent", g?.accent ?? "emerald");
  form.querySelectorAll("input[name=tags]").forEach(i => { i.checked = !!g?.tags.includes(i.value); });
  $("adult-row").hidden = !(canMarkAdult || g?.adultOnly);
  f.adultOnly.checked = !!g?.adultOnly;
  $("live-note").hidden = !g?.live;
  $("save").textContent = g ? "Save changes" : "Save draft";
  clearErrors(); syncFields(); updatePreview();
  $("editor").hidden = false;
  $("editor").scrollIntoView({ block: "start" });
  f.title.focus({ preventScroll: true });
}

function closeEditor() {
  $("editor").hidden = true;
  editing = null;
}

form.addEventListener("input", () => { syncFields(); updatePreview(); });
form.addEventListener("change", () => { syncFields(); updatePreview(); });
form.addEventListener("submit", async e => {
  e.preventDefault();
  clearErrors();
  const btn = $("save");
  btn.disabled = true;
  const r = editing
    ? await api(`/api/games/${editing.id}`, { method: "PATCH", body: formData() })
    : await api("/api/games", { method: "POST", body: formData() });
  btn.disabled = false;
  if (!r.ok) {
    showError(r.data.field, r.data.error || "That didn't save. Try again in a moment.");
    if (r.data.needs === "adult") openAgeConfirm(r.data.error);
    return;
  }
  const saved = r.data.game;
  toast(editing ? (saved.live ? "Saved. The games page shows your changes now." : "Changes saved.") : "Draft saved. Launch it when you're ready.");
  closeEditor();
  await load();
  document.querySelector(`.lp-row[data-id="${saved.id}"]`)?.scrollIntoView({ block: "center" });
});

// ---------- Signed in or not ----------
await ready;
let loadedFor = null;
onUser(user => {
  $("signed-out").hidden = !!user;
  $("games-app").hidden = !user;
  if (!user?.ageGroup || user.ageGroup === "under13") return;
  const key = `${user.id}:${user.ageGroup}`;
  if (key === loadedFor) return;
  loadedFor = key;
  load(launchedId ? 10 : 0);
});
