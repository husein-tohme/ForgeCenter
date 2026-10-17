import { $, api, esc, icon, registerIcons, toast, getUser } from "./common.js";

registerIcons({
  "rbx-obby": { c: { p: "#e8e8e8", g: "#3bd16f", s: "#b4b4b4", S: "#5c5f66", l: "#e8572a" }, m: [
    ".....pgg", ".....pg.", ".....p..", "....ssss", "..ssSSSS", "ssSS....", "SS......", "llllllll"] },
  "rbx-tycoon": { c: { K: "#5c5f66", k: "#2e3035", y: "#f2c230", Y: "#b8860b", b: "#3b7bd6", B: "#2546a8" }, m: [
    ".KKKKKK.", ".KkkkkK.", "...kk...", "...yy...", "...YY...", ".yy.....", "bbbbbbbb", "BBBBBBBB"] },
  "rbx-sim": { c: { k: "#1c1c1c", w: "#ffffff", y: "#f2c230", Y: "#b8860b" }, m: [
    "k....yy.", "kk..yYYy", "kwk.yYYy", "kwwk.yy.", "kwwwk...", "kwwwwk..", "kwkkkkk.", "kk......"] },
  "rbx-round": { c: { s: "#8a8e96", k: "#2e3035", w: "#ede6d6", r: "#d9372b" }, m: [
    "...ss...", "..kkkk..", ".kwwwwk.", "kwwwrwwk", "kwwwrwwk", "kwwwrrwk", ".kwwwwk.", "..kkkk.."] },
  "rbx-folder": { c: { Y: "#b07a14", l: "#f2c94c" }, m: [
    "........", "YYYY....", "YllYYYYY", "YllllllY", "YllllllY", "YllllllY", "YYYYYYYY", "........"] },
  "rbx-script": { c: { k: "#2546a8", w: "#e8f0ff", b: "#3b7bd6" }, m: [
    ".kkkk...", ".kwwwk..", ".kwbbwk.", ".kwwwwk.", ".kwbbbk.", ".kwwwwk.", ".kwbbwk.", ".kkkkkk."] },
  "rbx-doc": { c: { k: "#5c5f66", w: "#f2f2f2", g: "#a0a0a0" }, m: [
    ".kkkk...", ".kwwwk..", ".kwggwk.", ".kwwwwk.", ".kwgggk.", ".kwwwwk.", ".kwggwk.", ".kkkkkk."] },
});

const STORE = "fc-roblox-forge";
const form = $("rbx-form");
// form.name is the form's own name, so fields are looked up this way.
const field = name => form.elements.namedItem(name);

let options = null;   // templates, extras, numbers and limits from the server
let project = null;   // the latest preview: file list, a few files' text, main script
let openPath = null;  // the file shown in the code pane

// ---------- Form ----------
const numberInput = n => `<label>${esc(n.label)}<input type="number" name="${esc(n.id)}" min="${n.min}" max="${n.max}"
  step="${n.integer ? 1 : "any"}" inputmode="${n.integer ? "numeric" : "decimal"}" placeholder="${n.default}"></label>`;

function renderForm() {
  $("rbx-templates").innerHTML = options.templates.map(t => `
    <label class="rbx-template">
      <input type="radio" name="template" value="${esc(t.id)}">
      <span class="slot">${icon(t.icon)}</span>
      <span class="rbx-template-text"><strong>${esc(t.label)}</strong><span class="small">${esc(t.text)}</span></span>
    </label>`).join("");

  // Numbers for the whole game or one template go in the Numbers box; an extra's own
  // numbers sit under its checkbox.
  const templateIds = new Set(options.templates.map(t => t.id));
  $("rbx-numbers").innerHTML = options.numbers.filter(n => n.for === null || templateIds.has(n.for))
    .map(n => numberInput(n).replace("<label>", `<label data-for="${esc(n.for ?? "")}">`)).join("");

  $("rbx-extras").innerHTML = options.extras.map(x => {
    const settings = (x.id === "vip" ? `<label>Game pass id<input name="gamePassId" inputmode="numeric" maxlength="${options.limits.gamePassDigits}" placeholder="123456789" autocomplete="off"></label>
        <p class="small">Create the game pass on the Creator Hub first. The id is the number in its link.</p>` : "")
      + options.numbers.filter(n => n.for === x.id).map(numberInput).join("");
    return `
    <div class="rbx-extra">
      <label class="check-row"><input type="checkbox" name="extras" value="${esc(x.id)}">${esc(x.label)}</label>
      <p class="small">${esc(x.text)}</p>
      ${settings ? `<div class="rbx-extra-settings" data-extra="${esc(x.id)}" hidden>${settings}</div>` : ""}
    </div>`;
  }).join("");
}

const template = () => form.querySelector("[name=template]:checked")?.value ?? options.templates[0].id;
const extras = () => [...form.querySelectorAll("[name=extras]:checked")].map(i => i.value);

// Shows only the settings that matter for the chosen template and extras.
function syncVisibility() {
  const t = template();
  form.querySelectorAll("#rbx-numbers [data-for]").forEach(l => { l.hidden = !!l.dataset.for && l.dataset.for !== t; });
  const on = extras();
  form.querySelectorAll("[data-extra]").forEach(d => { d.hidden = !on.includes(d.dataset.extra); });
}

function data() {
  const f = new FormData(form);
  const body = {
    template: template(), extras: extras(),
    name: String(f.get("name") ?? "").trim(), currency: String(f.get("currency") ?? "").trim(),
  };
  if (body.extras.includes("vip")) body.gamePassId = String(f.get("gamePassId") ?? "").trim();
  for (const n of options.numbers) {
    const relevant = n.for === null || n.for === body.template || body.extras.includes(n.for);
    const value = String(f.get(n.id) ?? "").trim();
    if (relevant && value) body[n.id] = value;
  }
  return body;
}

function remember() {
  const f = new FormData(form);
  const saved = { template: template(), extras: extras() };
  for (const [k, v] of f) if (k !== "template" && k !== "extras") saved[k] = v;
  try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch {}
}

function restore() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE) || "null"); } catch {}
  const pick = saved && options.templates.some(t => t.id === saved.template) ? saved.template : options.templates[0].id;
  form.querySelector(`[name=template][value="${pick}"]`).checked = true;
  if (!saved || typeof saved !== "object") return;
  for (const box of form.querySelectorAll("[name=extras]")) box.checked = Array.isArray(saved.extras) && saved.extras.includes(box.value);
  for (const [k, v] of Object.entries(saved)) {
    const input = field(k);
    if (typeof v === "string" && input instanceof HTMLInputElement && input.type !== "radio" && input.type !== "checkbox") input.value = v;
  }
}

// ---------- Preview ----------
// The server builds the preview, so it always matches the download exactly.
let previewRun = 0, debounce;
async function preview() {
  const run = ++previewRun;
  const body = data();
  if (!body.name) body.name = "My Roblox Game";
  if (!body.currency) delete body.currency;
  body.open = openPath;
  const r = await api("/api/roblox/preview", { method: "POST", body });
  if (run !== previewRun) return;
  $("rbx-error").hidden = r.ok;
  document.querySelector(".rbx-preview").classList.toggle("is-stale", !r.ok);
  if (!r.ok) {
    $("rbx-error").textContent = r.data.error || "The preview couldn't be made. Try again.";
    if (project?.text[openPath] === undefined) $("rbx-code").textContent = "Fix the problem below to see this file.";
    return;
  }
  // Follow the game's main script when the template changes.
  if (!openPath || openPath === project?.main || !r.data.files.some(f => f.path === openPath)) openPath = r.data.main;
  project = r.data;
  renderTree();
  showFile();
  remember();
}
const schedulePreview = () => { clearTimeout(debounce); debounce = setTimeout(preview, 250); };

function renderTree() {
  const root = { dirs: {}, files: [] };
  for (const f of project.files) {
    const parts = f.path.split("/");
    let node = root;
    for (const dir of parts.slice(0, -1)) node = node.dirs[dir] ??= { dirs: {}, files: [] };
    node.files.push({ ...f, name: parts.at(-1) });
  }
  const list = node => `<ul>${Object.entries(node.dirs).map(([name, child]) => `
      <li><span class="rbx-row rbx-dir"><span class="rbx-ico">${icon("rbx-folder")}</span>${esc(name)}</span>${list(child)}</li>`).join("")}${
    node.files.map(f => `
      <li><button type="button" class="rbx-row rbx-file" data-path="${esc(f.path)}"${f.path === openPath ? ` aria-current="true"` : ""}>
        <span class="rbx-ico">${icon(f.name.endsWith(".lua") ? "rbx-script" : "rbx-doc")}</span>${esc(f.name)}</button></li>`).join("")}</ul>`;
  $("rbx-tree").innerHTML = `<span class="rbx-row rbx-dir rbx-root"><span class="rbx-ico">${icon("rbx-folder")}</span>${esc(project.slug)}</span>${list(root)}`;
  const lua = project.files.filter(f => f.path.endsWith(".lua"));
  $("rbx-summary").textContent = `${project.files.length} files, including ${lua.length} Luau scripts with ${lua.reduce((s, f) => s + f.lines, 0).toLocaleString()} lines. Pick a file to read it.`;
}

function showFile() {
  const file = project.files.find(f => f.path === openPath);
  $("rbx-open-name").textContent = openPath;
  $("rbx-open-lines").textContent = file ? `${file.lines} lines` : "";
  const text = project.text[openPath];
  $("rbx-code").textContent = text ?? "Loading…";
  if (text === undefined) preview();
}

$("rbx-tree").addEventListener("click", e => {
  const button = e.target.closest("[data-path]");
  if (!button) return;
  openPath = button.dataset.path;
  $("rbx-tree").querySelectorAll("[data-path]").forEach(b => {
    if (b === button) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
  });
  $("rbx-code").scrollTop = 0;
  showFile();
});

form.addEventListener("input", schedulePreview);
form.addEventListener("change", e => {
  if (e.target.matches("[name=template], [name=extras]")) { syncVisibility(); schedulePreview(); }
});

// ---------- Download ----------
form.addEventListener("submit", async e => {
  e.preventDefault();
  const body = data();
  if (!body.name) { field("name").focus(); return toast("Give your game a name first."); }
  if (!body.currency) delete body.currency;
  const button = $("rbx-download");
  button.disabled = true;
  try {
    // A file comes back, not JSON, so this uses fetch directly (same-origin JSON, like api()).
    const r = await fetch("/api/roblox/zip", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) return toast((await r.json().catch(() => ({}))).error || "The project couldn't be made. Try again.");
    const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? "roblox-game.zip";
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(await r.blob()), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    toast(getUser() ? "Project downloaded and saved to your account. The steps below show how to open it."
      : "Project downloaded. The steps below show how to open it in Roblox Studio.");
  } catch {
    toast("You seem to be offline. Check your connection and try again.");
  } finally {
    button.disabled = false;
  }
});

// ---------- Start ----------
const r = await api("/api/roblox/options");
if (!r.ok) {
  $("rbx-summary").textContent = "";
  $("rbx-error").hidden = false;
  $("rbx-error").textContent = r.data.error || "Roblox Forge couldn't load. Refresh the page to try again.";
} else {
  options = r.data;
  renderForm();
  restore();
  syncVisibility();
  preview();
}
