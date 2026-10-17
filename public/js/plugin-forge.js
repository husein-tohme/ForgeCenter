import { $, api, toast } from "./common.js";

const STORE = "fc-plugin-forge";
const form = $("plugin-form");
const rows = $("command-rows");
const MAX_COMMANDS = 10;
// form.name is the form's own name, so fields are looked up this way.
const field = name => form.elements.namedItem(name);

function addRow(name = "", reply = "") {
  if (rows.children.length >= MAX_COMMANDS) return toast(`A plugin can have up to ${MAX_COMMANDS} commands.`);
  const n = rows.children.length + 1;
  rows.insertAdjacentHTML("beforeend", `
    <div class="command-row">
      <label>Command ${n}<span class="slash"><span aria-hidden="true">/</span><input name="cmd-name" maxlength="32" placeholder="discord" aria-label="Command ${n} name"></span></label>
      <label class="grow">Reply<input name="cmd-reply" maxlength="256" placeholder="<aqua>Join us at discord.gg/yourserver" aria-label="Command ${n} reply"></label>
      <button type="button" class="link-btn" data-remove aria-label="Remove command ${n}">Remove</button>
    </div>`);
  const row = rows.lastElementChild;
  row.querySelector("[name=cmd-name]").value = name;
  row.querySelector("[name=cmd-reply]").value = reply;
}

function data() {
  const f = new FormData(form);
  return {
    name: f.get("name").trim(), author: f.get("author").trim(), description: f.get("description").trim(),
    gameVersion: f.get("gameVersion"), welcome: f.get("welcome"), announcements: f.get("announcements"),
    announceEvery: f.get("announceEvery"),
    commands: [...rows.children].map(r => ({ name: r.querySelector("[name=cmd-name]").value, reply: r.querySelector("[name=cmd-reply]").value })),
  };
}

// The server builds the preview, so it always matches the download exactly.
let previewRun = 0, debounce;
async function preview() {
  const run = ++previewRun;
  const body = data();
  if (!body.name) body.name = "My Plugin";
  if (!body.author) body.author = "you";
  const r = await api("/api/plugin/preview", { method: "POST", body });
  if (run !== previewRun) return;
  $("preview-error").hidden = r.ok;
  if (!r.ok) { $("preview-error").textContent = r.data.error; return; }
  $("preview-plugin").textContent = r.data.files["plugin.yml"];
  $("preview-config").textContent = r.data.files["config.yml"];
  try { localStorage.setItem(STORE, JSON.stringify(data())); } catch {}
}
const schedulePreview = () => { clearTimeout(debounce); debounce = setTimeout(preview, 250); };

form.addEventListener("input", schedulePreview);
$("add-command").addEventListener("click", () => { addRow(); rows.lastElementChild?.querySelector("input").focus(); schedulePreview(); });
rows.addEventListener("click", e => {
  if (!e.target.matches("[data-remove]")) return;
  e.target.closest(".command-row").remove();
  schedulePreview();
});

form.addEventListener("submit", async e => {
  e.preventDefault();
  const body = data();
  if (!body.name) { field("name").focus(); return toast("Give the plugin a name first."); }
  if (!body.author) { field("author").focus(); return toast("Add your name first."); }
  const r = await fetch("/api/plugin/zip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) return toast((await r.json().catch(() => ({}))).error || "The plugin couldn't be made. Try again.");
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(await r.blob()), download: `${body.name.replace(/\W+/g, "-")}.zip` });
  a.click();
  toast("Plugin project downloaded.");
});

// ---------- Start ----------
const options = await api("/api/plugin/options");
const versions = options.data.versions ?? ["1.21.1"];
$("version").innerHTML = versions.map(v => `<option value="${v}">${v}</option>`).join("");
$("version").value = versions.includes("1.21.1") ? "1.21.1" : versions[0];

let saved = null;
try { saved = JSON.parse(localStorage.getItem(STORE) || "null"); } catch {}
if (saved && typeof saved === "object") {
  for (const key of ["name", "author", "description", "welcome", "announcements", "announceEvery"]) {
    if (typeof saved[key] === "string" && field(key)) field(key).value = saved[key];
  }
  if (versions.includes(saved.gameVersion)) $("version").value = saved.gameVersion;
  (Array.isArray(saved.commands) ? saved.commands : []).slice(0, MAX_COMMANDS)
    .forEach(c => addRow(String(c?.name ?? ""), String(c?.reply ?? "")));
}
if (!rows.children.length) {
  addRow("discord", "<aqua>Join our Discord: discord.gg/yourserver");
  addRow("rules", "<yellow>Be kind, no griefing, and have fun, {player}!");
}
preview();
