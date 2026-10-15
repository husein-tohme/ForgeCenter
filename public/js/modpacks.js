import { $, api, esc, icon, toast } from "./common.js";

const STORE = "fc-modpack-forge";
const picked = new Map(); // project id -> { title, icon }
let results = [];
let searchRun = 0;

const compact = n => Intl.NumberFormat("en", { notation: "compact" }).format(n);
const modIcon = m => m.icon
  ? `<img src="${esc(m.icon)}" alt="" width="48" height="48" loading="lazy">`
  : `<span class="mod-fallback">${icon("chest")}</span>`;

// ---------- Search ----------
async function search() {
  const run = ++searchRun;
  const r = await api(`/api/modrinth/search?q=${encodeURIComponent($("query").value.trim())}&version=${encodeURIComponent($("version").value)}`);
  if (run !== searchRun) return;
  if (!r.ok) { $("results").innerHTML = `<li class="error">${esc(r.data.error)}</li>`; return; }
  results = r.data.results;
  renderResults();
}

function renderResults() {
  if (!results.length) {
    $("results").innerHTML = `<li class="hint">No Fabric mods match that for Minecraft ${esc($("version").value)}. Try another word or version.</li>`;
    return;
  }
  $("results").innerHTML = results.map(m => `
    <li class="result">
      <span class="result-icon">${modIcon(m)}</span>
      <div class="result-text">
        <strong><a href="https://modrinth.com/mod/${esc(m.slug)}" target="_blank" rel="noopener">${esc(m.title)}</a></strong>
        <span class="small">by ${esc(m.author)}, ${compact(m.downloads)} downloads</span>
        <p>${esc(m.description)}</p>
      </div>
      <button type="button" class="btn btn-small ${picked.has(m.id) ? "" : "btn-buy"}" data-toggle="${esc(m.id)}"
        aria-pressed="${picked.has(m.id)}">${picked.has(m.id) ? "Added" : "Add"}</button>
    </li>`).join("");
}

let debounce;
$("query").addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(search, 300); });
$("version").addEventListener("change", () => { clearPlan(); search(); save(); });

$("results").addEventListener("click", e => {
  const b = e.target.closest("[data-toggle]"); if (!b) return;
  const m = results.find(r => r.id === b.dataset.toggle);
  if (picked.has(m.id)) picked.delete(m.id);
  else {
    if (picked.size >= 50) return toast("A modpack can start with up to 50 mods.");
    picked.set(m.id, { title: m.title, icon: m.icon });
  }
  clearPlan(); renderResults(); renderPicked();
});

// ---------- Picked mods ----------
function renderPicked() {
  $("picked").innerHTML = picked.size
    ? [...picked].map(([id, m]) => `<li><span class="result-icon small-icon">${modIcon(m)}</span><span>${esc(m.title)}</span>
        <button type="button" class="btn btn-small" data-remove="${esc(id)}" aria-label="Remove ${esc(m.title)}">Remove</button></li>`).join("")
    : `<li class="hint">Add mods from the search to start your pack.</li>`;
  save();
}
$("picked").addEventListener("click", e => {
  const b = e.target.closest("[data-remove]"); if (!b) return;
  picked.delete(b.dataset.remove);
  clearPlan(); renderPicked(); renderResults();
});

// ---------- Check and download ----------
const clearPlan = () => { $("plan").innerHTML = ""; };
const body = () => {
  const f = new FormData($("pack-form"));
  return { name: f.get("name").trim() || "My Modpack", summary: f.get("summary").trim(), gameVersion: $("version").value, projectIds: [...picked.keys()] };
};

$("check").addEventListener("click", async e => {
  if (!picked.size) return toast("Add at least one mod first.");
  e.target.disabled = true;
  $("plan").innerHTML = `<p class="hint">Checking each mod on Modrinth…</p>`;
  const r = await api("/api/modpack/plan", { method: "POST", body: body() });
  e.target.disabled = false;
  if (!r.ok) { $("plan").innerHTML = `<p class="error">${esc(r.data.error)}</p>`; return; }
  const { files, skipped, loaderVersion, gameVersion } = r.data.plan;
  $("plan").innerHTML = `
    <h3>${files.length} mod${files.length === 1 ? "" : "s"} for Minecraft ${esc(gameVersion)}, Fabric Loader ${esc(loaderVersion)}</h3>
    <ul class="plan-list">${files.map(f => `<li>${esc(f.title)} <span class="small">${esc(f.versionNumber)}${f.required ? ", added because another mod needs it" : ""}</span></li>`).join("")}</ul>
    ${skipped.length ? `<p class="error">Not available for ${esc(gameVersion)} on Fabric, so left out: ${skipped.map(s => esc(s.title)).join(", ")}.</p>` : ""}`;
});

$("pack-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (!picked.size) return toast("Add at least one mod first.");
  $("download").disabled = true;
  const b = body();
  const r = await fetch("/api/modpack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  $("download").disabled = false;
  if (!r.ok) return toast((await r.json().catch(() => ({}))).error || "The modpack couldn't be made. Try again.");
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(await r.blob()), download: `${b.name.replace(/\W+/g, "-")}.mrpack` });
  a.click();
  toast("Modpack downloaded. Open it with the Modrinth App or Prism Launcher.");
});

// ---------- Remember picks on this device ----------
function save() {
  try { localStorage.setItem(STORE, JSON.stringify({ version: $("version").value, picked: [...picked] })); } catch {}
}
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "null");
    for (const [id, m] of saved?.picked ?? []) if (typeof id === "string" && typeof m?.title === "string") picked.set(id, { title: m.title, icon: typeof m.icon === "string" && m.icon.startsWith("https://cdn.modrinth.com/") ? m.icon : null });
    return saved?.version;
  } catch { return null; }
}

// ---------- Start ----------
const savedVersion = restore();
const v = await api("/api/modrinth/versions");
const versions = v.data.versions ?? ["1.21.1"];
$("version").innerHTML = versions.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join("");
$("version").value = versions.includes(savedVersion) ? savedVersion : versions.includes("1.21.1") ? "1.21.1" : versions[0];
renderPicked();
search();
