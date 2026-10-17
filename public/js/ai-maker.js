import { $, api, esc, toast, onUser, openSignIn } from "./common.js";
import { AVATARS, avatarIcon, avatarLabel } from "./ai-avatars.js";

const form = $("assistant-form");
const FIELDS = ["name", "greeting", "instructions", "knowledge"];
const field = name => form.elements.namedItem(name);
const DEFAULT_LIMITS = { name: 40, greeting: 300, instructions: 4000, knowledge: 20000 };

let list = [], max = 3, planMax = 20, limits = DEFAULT_LIMITS, aiOn = true;
let current = null;      // the saved assistant being edited, or null for a new one
let dirty = false, saving = false, loaded = false;
let chat = [];           // the test chat, kept only in this tab
const wanted = Number(new URLSearchParams(location.search).get("a")) || null;

$("signin-here").addEventListener("click", () => openSignIn());

onUser(async user => {
  $("signed-out").hidden = !!user;
  $("maker").hidden = !user;
  if (!user?.ageGroup || user.ageGroup === "under13" || loaded) return;
  loaded = true;
  await loadList();
  const start = list.find(a => a.id === wanted) ?? list[0] ?? null;
  open(start);
});

// ---------- Avatar picker ----------
$("avatar-grid").innerHTML = Object.entries(AVATARS).map(([key, a]) => `
  <label class="avatar-opt" title="${esc(a.label)}">
    <input type="radio" name="avatar" value="${key}" aria-label="${esc(a.label)}">
    <span class="slot">${avatarIcon(key)}</span>
  </label>`).join("");

// ---------- The list, as a row of inventory slots ----------
async function loadList() {
  const r = await api("/api/assistants");
  if (!r.ok) { toast(r.data.error || "Your assistants couldn't load. Refresh the page to try again."); return; }
  ({ assistants: list, max, planMax, limits = DEFAULT_LIMITS, ai: aiOn } = r.data);
  renderList();
}

function renderList() {
  const full = list.length >= max;
  $("count").innerHTML = `${list.length} of ${max} assistants.${full && max < planMax
    ? ` The <a href="/#shop">Dedicated AI plan</a> lets you make up to ${planMax}.` : ""}`;
  $("assistants").innerHTML = list.map(a => `<li>
      <button class="hot-slot" type="button" data-id="${a.id}" aria-current="${a.id === current?.id}">
        <span class="slot">${avatarIcon(a.avatar)}</span>
        <span class="hot-name">${esc(a.name)}</span>
        ${a.hidden ? `<span class="pill pill-bad">Hidden</span>` : a.shared ? `<span class="pill pill-done">Shared</span>` : ""}
      </button></li>`).join("") + `<li>
      <button class="hot-slot hot-new" type="button" id="new-assistant" aria-current="${!current}">
        <span class="slot" aria-hidden="true">+</span><span class="hot-name">New</span>
      </button></li>`;
  $("assistants").querySelectorAll("[data-id]").forEach(b => b.addEventListener("click", () => {
    const a = list.find(x => x.id === Number(b.dataset.id));
    if (a && a.id !== current?.id && confirmDiscard()) open(a);
  }));
  $("new-assistant").addEventListener("click", () => {
    if (list.length >= max) {
      return toast(max < planMax
        ? `You can make up to ${max} assistants. Delete one, or get the Dedicated AI plan for up to ${planMax}.`
        : `You can make up to ${max} assistants. Delete one to make another.`);
    }
    if (current && confirmDiscard()) open(null);
  });
}

const confirmDiscard = () => !dirty || confirm("You have unsaved changes. Leave them?");
window.addEventListener("beforeunload", e => { if (dirty) e.preventDefault(); });

// ---------- Editor ----------
function open(a) {
  current = a;
  chat = [];
  const src = a ?? { name: "", greeting: "", instructions: "", knowledge: "", avatar: "robot" };
  FIELDS.forEach(k => { field(k).value = src[k] ?? ""; field(k).maxLength = limits[k]; });
  (form.querySelector(`input[name=avatar][value="${src.avatar}"]`) ?? form.querySelector("input[name=avatar]")).checked = true;
  $("editor-title").textContent = a ? "Edit assistant" : "New assistant";
  $("delete").hidden = !a;
  $("hidden-note").hidden = !a?.hidden;
  setDirty(false);
  $("save-state").textContent = "";
  updateCounters();
  renderShare();
  renderList();
  renderChat();
  window.history.replaceState(null, "", a ? `?a=${a.id}` : location.pathname);
}

function updateCounters() {
  form.querySelectorAll(".counter").forEach(c => {
    const input = $(c.dataset.for);
    const limit = limits[input.name];
    c.textContent = `${input.value.length.toLocaleString("en-US")} / ${limit.toLocaleString("en-US")}`;
    c.classList.toggle("full", input.value.length >= limit);
  });
}

function setDirty(value) {
  dirty = value;
  $("save-state").textContent = value ? "Unsaved changes" : $("save-state").textContent;
}

form.addEventListener("input", e => {
  setDirty(true);
  updateCounters();
  if (e.target.name === "avatar" || e.target.name === "name" || e.target.name === "greeting") renderChat();
});

const values = () => ({
  ...Object.fromEntries(FIELDS.map(k => [k, field(k).value])),
  avatar: form.querySelector("input[name=avatar]:checked")?.value ?? "robot",
});

// Saves the form; returns whether it worked.
async function save() {
  if (saving) return false;
  const body = values();
  if (!body.name.trim()) { toast("Give your assistant a name."); field("name").focus(); return false; }
  saving = true;
  $("save").disabled = true;
  const r = current
    ? await api(`/api/assistants/${current.id}`, { method: "PATCH", body })
    : await api("/api/assistants", { method: "POST", body });
  saving = false;
  $("save").disabled = false;
  if (!r.ok) { toast(r.data.error || "That didn't save. Try again in a moment."); return false; }
  const saved = r.data.assistant;
  const i = list.findIndex(a => a.id === saved.id);
  if (i >= 0) list[i] = saved; else list.push(saved);
  const wasNew = !current;
  current = saved;
  setDirty(false);
  $("save-state").textContent = "Saved";
  $("editor-title").textContent = "Edit assistant";
  $("delete").hidden = false;
  if (wasNew) window.history.replaceState(null, "", `?a=${saved.id}`);
  renderList();
  renderShare();
  return true;
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  if (await save()) toast(`${current.name} is saved.`);
});

$("delete").addEventListener("click", async () => {
  if (!current) return;
  if (!confirm(`Delete ${current.name}? Its share link will stop working. This can't be undone.`)) return;
  const r = await api(`/api/assistants/${current.id}`, { method: "DELETE" });
  if (!r.ok) return toast(r.data.error || "That didn't delete. Try again in a moment.");
  const name = current.name;
  list = list.filter(a => a.id !== current.id);
  dirty = false;
  open(list[0] ?? null);
  toast(`${name} was deleted.`);
});

// ---------- Sharing ----------
function renderShare() {
  $("share").hidden = !current;
  if (!current) return;
  $("share-toggle").checked = current.shared;
  $("share-on").hidden = !current.shared;
  $("share-link").value = current.shareUrl;
}

async function share(body) {
  const r = await api(`/api/assistants/${current.id}/share`, { method: "POST", body });
  if (!r.ok) { toast(r.data.error || "Sharing didn't change. Try again in a moment."); renderShare(); return null; }
  const saved = r.data.assistant;
  // Keep any unsaved edits in the form: only the sharing details change here.
  current = { ...current, shared: saved.shared, shareToken: saved.shareToken, shareUrl: saved.shareUrl, hidden: saved.hidden };
  list = list.map(a => (a.id === current.id ? { ...a, shared: saved.shared, shareToken: saved.shareToken, shareUrl: saved.shareUrl } : a));
  renderShare();
  renderList();
  return saved;
}

$("share-toggle").addEventListener("change", async e => {
  const saved = await share({ shared: e.target.checked });
  if (saved) toast(saved.shared ? (saved.hidden ? "Sharing is on, but the link won't work while ForgeCenter has it hidden." : "Sharing is on. Copy the link to send it.") : "Sharing is off. The link doesn't work any more.");
});

$("copy-link").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(current.shareUrl); toast("Link copied."); }
  catch { $("share-link").select(); toast("Press Ctrl+C (or Cmd+C) to copy the link."); }
});

$("new-link").addEventListener("click", async () => {
  if (!confirm("Make a new link? The old one will stop working for everyone who has it.")) return;
  if (await share({ shared: current.shared, regenerate: true })) toast("New link made. The old one doesn't work any more.");
});

// ---------- Test chat ----------
const bubble = (who, name, text, extra = "") =>
  `<div class="msg-row ${who === "user" ? "from-customer" : "from-ai"}${extra}"><b>${who === "user" ? "You" : esc(name)}</b><p>${esc(text)}</p></div>`;

function renderChat(pending = null) {
  const v = values();
  const name = v.name.trim() || "Your assistant";
  $("tester-avatar").innerHTML = avatarIcon(v.avatar, avatarLabel(v.avatar));
  $("tester-title").textContent = `Test chat with ${name}`;
  const thread = $("test-thread");
  thread.innerHTML = (v.greeting.trim() ? bubble("assistant", name, v.greeting.trim()) : "")
    + chat.map(m => bubble(m.role, name, m.content)).join("")
    + (pending ? bubble("user", name, pending) + bubble("assistant", name, "Thinking…", " typing") : "")
    || `<p class="hint">Messages you send appear here.</p>`;
  thread.scrollTop = thread.scrollHeight;
  const off = !aiOn;
  $("test-input").disabled = off || !!pending;
  $("test-send").disabled = off || !!pending;
  if (off) $("test-note").textContent = "AI chat isn't set up on this site yet, so the test chat is off. You can still build and share assistants.";
}

$("test-form").addEventListener("submit", async e => {
  e.preventDefault();
  const text = $("test-input").value.trim();
  if (!text) return;
  // The chat uses the saved version, so save first.
  if ((dirty || !current) && !(await save())) return;
  renderChat(text);
  const messages = [...chat, { role: "user", content: text }].slice(-20).map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  const r = await api(`/api/assistants/${current.id}/chat`, { method: "POST", body: { messages } });
  if (!r.ok) { renderChat(); return toast(r.data.error || "The assistant couldn't answer. Try again in a moment."); }
  chat.push({ role: "user", content: text }, { role: "assistant", content: r.data.reply });
  $("test-input").value = "";
  renderChat();
  if (typeof r.data.remaining === "number") {
    $("test-note").textContent = `Chats aren't saved. You have ${r.data.remaining} AI ${r.data.remaining === 1 ? "message" : "messages"} left today.`;
  }
  $("test-input").focus();
});

$("test-input").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("test-form").requestSubmit(); }
});

$("test-clear").addEventListener("click", () => { chat = []; renderChat(); $("test-input").focus(); });
