import { $, api, esc, icon, cash, toast, onUser, openSignIn, openAgeConfirm } from "./common.js";
import { avatar, badgeList, badgeRow } from "./creator-badges.js";

let badgeInfo = {};
let sort = "top";
let mine = null; // the signed-in person's page, badges and referral numbers

// ---------- Directory ----------
async function loadDirectory() {
  const r = await api(`/api/creators?sort=${sort}`);
  if (!r.ok) { $("directory").innerHTML = `<li class="error">Creators couldn't load. Refresh the page to try again.</li>`; return; }
  badgeInfo = Object.fromEntries(r.data.badges.map(b => [b.key, b]));
  $("badge-guide").innerHTML = badgeList(r.data.badges, "badge-guide");
  $("directory").innerHTML = r.data.creators.length ? r.data.creators.map(c => `<li>
      <a class="panel creator-card" href="/c/${esc(c.handle)}">
        <span class="slot creator-avatar">${avatar(c.picture)}</span>
        <span class="card-text">
          <strong>${esc(c.name)}</strong>
          <span class="small">@${esc(c.handle)}${c.creations ? `, ${c.creations} creation${c.creations === 1 ? "" : "s"}` : ""}</span>
          ${c.bio ? `<span class="card-bio">${esc(c.bio)}</span>` : ""}
          ${c.badges.length ? badgeRow(c.badges, badgeInfo) : ""}
        </span>
      </a></li>`).join("")
    : `<li class="panel empty"><span class="empty-icon">${icon("table")}</span>
        <div><p><strong>No creator pages yet.</strong> Be the first: claim a handle and show what you make.</p>
        <a class="btn btn-buy" href="#yours">Make your page</a></div></li>`;
}

document.querySelectorAll("[data-sort]").forEach(b => b.addEventListener("click", () => {
  sort = b.dataset.sort;
  document.querySelectorAll("[data-sort]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  loadDirectory();
}));
loadDirectory();

// ---------- Your page ----------
$("signin-here").addEventListener("click", () => openSignIn());

let loadedFor = null;
onUser(user => {
  $("signed-out").hidden = !!user;
  $("editor").hidden = !user;
  if (!user?.ageGroup || user.ageGroup === "under13" || loadedFor === user.id) return;
  loadedFor = user.id;
  loadMine();
});

async function loadMine() {
  const r = await api("/api/creators/mine");
  if (!r.ok) return toast(r.data.error);
  mine = r.data;
  fillForm();
  renderSide();
}

// Mirrors the server's rules so mistakes show while typing. The server has the final say.
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,22})[a-z0-9]$/;
function handleProblem(h) {
  if (h.length < 3 || h.length > 24) return "Handles are 3 to 24 characters long.";
  if (!/^[a-z0-9-]+$/.test(h)) return "Use only lowercase letters, numbers and hyphens.";
  if (!HANDLE_RE.test(h)) return "Handles can't start or end with a hyphen.";
  return null;
}
const webUrl = s => { try { const u = new URL(s); return !/\s/.test(s) && ["http:", "https:"].includes(u.protocol) && u.hostname.includes(".") ? u : null; } catch { return null; } };
const hosted = (...hosts) => u => hosts.includes(u.hostname) && u.pathname.length > 1;
const SUPPORT_OK = {
  paypal: u => hosted("paypal.me", "www.paypal.me")(u) || (["paypal.com", "www.paypal.com"].includes(u.hostname) && /^\/paypalme\/[\w.-]+/i.test(u.pathname)),
  kofi: hosted("ko-fi.com", "www.ko-fi.com"),
  patreon: hosted("patreon.com", "www.patreon.com"),
  buymeacoffee: hosted("buymeacoffee.com", "www.buymeacoffee.com"),
  github: u => u.hostname === "github.com" && /^\/sponsors\/[\w-]+\/?$/i.test(u.pathname),
  stripe: hosted("buy.stripe.com"),
};

function setMsg(el, text, tone = "") {
  el.textContent = text;
  el.className = `field-msg${tone ? ` ${tone}` : ""}`;
}

function fillForm() {
  const p = mine.profile;
  $("handle").value = p?.handle ?? "";
  $("bio").value = p?.bio ?? "";
  $("link-rows").innerHTML = "";
  (p?.links ?? []).forEach(l => addLinkRow(l.label, l.url));
  if (!p?.links?.length) addLinkRow();
  $("add-link").hidden = $("link-rows").children.length >= mine.limits.links;

  $("support-adult").hidden = mine.canAddSupport;
  $("support-rows").innerHTML = mine.supportKinds.map(k => `
    <div class="support-row">
      <label for="support-${k.key}">${esc(k.label)}</label>
      <input id="support-${k.key}" data-kind="${k.key}" type="url" inputmode="url" maxlength="300" placeholder="${esc(k.example)}" ${mine.canAddSupport ? "" : "disabled"}>
      <p class="field-msg" aria-live="polite"></p>
    </div>`).join("");
  document.querySelectorAll("[data-kind]").forEach(i => { i.value = p?.support?.[i.dataset.kind] ?? ""; });

  $("hidden-note").hidden = !p?.hidden;
  $("view-page").hidden = !p;
  if (p) $("view-page").href = p.url;
  $("remove-page").hidden = !p || p.hidden; // a hidden page can't be removed and made again
  $("save").textContent = p ? "Save changes" : "Claim and save your page";
  $("form-error").hidden = true;
  setMsg($("handle-msg"), p ? `Your page is at ${location.host}${p.url}` : "3 to 24 lowercase letters, numbers or hyphens. It's also your referral code.");
  updateBioCount();
}

function addLinkRow(label = "", url = "") {
  const rows = $("link-rows");
  if (rows.children.length >= mine.limits.links) return toast(`You can add up to ${mine.limits.links} links.`);
  rows.insertAdjacentHTML("beforeend", `
    <div class="link-row">
      <label>Name<input name="link-label" maxlength="${mine.limits.label}" placeholder="YouTube"></label>
      <label class="grow">Address<input name="link-url" type="url" inputmode="url" maxlength="300" placeholder="https://"></label>
      <button class="link-btn" type="button" data-remove-link>Remove</button>
      <p class="field-msg" aria-live="polite"></p>
    </div>`);
  const row = rows.lastElementChild;
  row.querySelector("[name=link-label]").value = label;
  row.querySelector("[name=link-url]").value = url;
  $("add-link").hidden = rows.children.length >= mine.limits.links;
}

$("add-link").addEventListener("click", () => { addLinkRow(); $("link-rows").lastElementChild?.querySelector("input").focus(); });
$("link-rows").addEventListener("click", e => {
  if (!e.target.matches("[data-remove-link]")) return;
  e.target.closest(".link-row").remove();
  $("add-link").hidden = false;
});

// Live checks while typing.
let handleTimer, handleRun = 0;
$("handle").addEventListener("input", e => {
  const h = e.target.value.trim().toLowerCase();
  const msg = $("handle-msg");
  clearTimeout(handleTimer);
  const problem = handleProblem(h);
  if (problem) return setMsg(msg, problem, "bad");
  if (h === mine?.profile?.handle) return setMsg(msg, "This is your handle.", "ok");
  setMsg(msg, "Checking…");
  handleTimer = setTimeout(async () => {
    const run = ++handleRun;
    const r = await api(`/api/creators/check?handle=${encodeURIComponent(h)}`);
    if (run !== handleRun) return;
    if (!r.ok) return setMsg(msg, r.data.error || "Couldn't check that handle. Try again in a moment.", "bad");
    setMsg(msg, r.data.ok ? `${h} is free. Your page will be ${location.host}/c/${h}` : r.data.error, r.data.ok ? "ok" : "bad");
  }, 350);
});

function updateBioCount() {
  const n = $("bio").value.length, max = mine?.limits.bio ?? 300;
  setMsg($("bio-msg"), `${n} of ${max} characters`, n > max ? "bad" : "");
}
$("bio").addEventListener("input", updateBioCount);

$("link-rows").addEventListener("input", e => {
  const row = e.target.closest(".link-row");
  const url = row.querySelector("[name=link-url]").value.trim();
  const label = row.querySelector("[name=link-label]").value.trim();
  const msg = row.querySelector(".field-msg");
  if (url && !webUrl(url)) setMsg(msg, "Use a full web address starting with https:// or http://.", "bad");
  else if (label && !url) setMsg(msg, "Add the address for this link, or remove it.", "bad");
  else setMsg(msg, "");
});

$("support-rows").addEventListener("input", e => {
  const input = e.target.closest("[data-kind]");
  if (!input) return;
  const value = input.value.trim();
  const msg = input.parentElement.querySelector(".field-msg");
  const kind = mine.supportKinds.find(k => k.key === input.dataset.kind);
  const u = value && webUrl(value);
  if (!value) setMsg(msg, "");
  else if (!u || u.protocol !== "https:" || !SUPPORT_OK[kind.key](u)) setMsg(msg, `Use a link like ${kind.example}`, "bad");
  else setMsg(msg, "Looks good.", "ok");
});

const formData = () => ({
  handle: $("handle").value.trim().toLowerCase(),
  bio: $("bio").value,
  links: [...$("link-rows").children].map(r => ({
    label: r.querySelector("[name=link-label]").value, url: r.querySelector("[name=link-url]").value })),
  support: Object.fromEntries([...document.querySelectorAll("[data-kind]")].map(i => [i.dataset.kind, i.value.trim()])),
});

// Points at the field the server named, so the fix is obvious.
function showError(data) {
  $("form-error").textContent = data.error || "Your page couldn't be saved. Try again in a moment.";
  $("form-error").hidden = false;
  const field = String(data.field ?? "");
  let input = null;
  if (field === "handle") { input = $("handle"); setMsg($("handle-msg"), data.error, "bad"); }
  else if (field === "bio") input = $("bio");
  else if (field.startsWith("link-")) {
    // The server numbers the links it kept, skipping rows with no address.
    const rows = [...$("link-rows").children].filter(r => r.querySelector("[name=link-url]").value.trim());
    const row = rows[Number(field.slice(5))];
    if (row) { input = row.querySelector("[name=link-url]"); setMsg(row.querySelector(".field-msg"), data.error, "bad"); }
  } else if (field.startsWith("support-")) {
    input = document.querySelector(`[data-kind="${field.slice(8)}"]`);
    if (input) setMsg(input.parentElement.querySelector(".field-msg"), data.error, "bad");
  }
  input?.focus();
  if (data.needs === "adult") openAgeConfirm(data.error);
}

$("creator-form").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("save");
  btn.disabled = true;
  const first = !mine.profile;
  const r = await api("/api/creators/mine", { method: "PUT", body: formData() });
  btn.disabled = false;
  if (!r.ok) return showError(r.data);
  mine = r.data;
  fillForm();
  renderSide();
  loadDirectory();
  toast(first ? "Your creator page is live." : "Changes saved.");
});

$("remove-page").addEventListener("click", async () => {
  if (!confirm("Remove your creator page? Your handle becomes free for someone else, and your referral link stops working.")) return;
  const r = await api("/api/creators/mine", { method: "DELETE" });
  if (!r.ok) return toast(r.data.error);
  mine = r.data;
  fillForm();
  renderSide();
  loadDirectory();
  toast("Your creator page is removed.");
});

// ---------- Badges and referral link ----------
function renderSide() {
  $("my-badges").innerHTML = mine.badges.length ? badgeList(mine.badges, "compact")
    : `<p class="hint">Make something with the <a href="/#tools">free tools</a> to earn your first badge.</p>`;

  const ref = mine.referral;
  const paused = !(ref.percent > 0 && ref.capCents > 0);
  $("referral-body").innerHTML = ref.link ? `
    <p class="small">${paused ? "Referral rewards are paused right now, but people who join through your link still count."
      : `When someone makes a new account through your link and pays for their first order by card, you get ${ref.percent}% of it as wallet credit, up to ${cash(ref.capCents)} per person.`}</p>
    <div class="ref-link">
      <label class="sr-only" for="ref-url">Your referral link</label>
      <input id="ref-url" readonly>
      <button class="btn btn-small" type="button" id="copy-ref">Copy</button>
    </div>
    <dl class="ref-stats">
      <div class="slot-stat"><dt>People who joined</dt><dd>${ref.referred}</dd></div>
      <div class="slot-stat"><dt>Rewards earned</dt><dd>${cash(ref.earnedCents)}</dd></div>
    </dl>
    <p class="small">Rewards land in your <a href="/account#wallet">wallet</a> to spend on ForgeCenter. They can't be withdrawn, and your own accounts don't count.</p>`
    : `<p class="hint">Save your page to get a referral link. Your handle is your code.</p>`;
  if (!ref.link) return;
  $("ref-url").value = ref.link;
  $("copy-ref").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(ref.link); toast("Referral link copied."); }
    catch { $("ref-url").select(); toast("Select the link and copy it."); }
  });
}
