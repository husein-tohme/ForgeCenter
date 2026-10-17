import { $, api, esc, date, toast, onUser, openSignIn } from "./common.js";

// Versions of one site share a name, so the list shows the time too.
const when = iso => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// Small colour previews for the look cards, matching the prompt each look sends.
const SWATCH = {
  pixel: ["#5da33a", "#8b5a2b", "#8b8b8b"],
  modern: ["#ffffff", "#e8edf5", "#3b6fd6"],
  gamer: ["#0d0f14", "#16e0ff", "#ff2fb4"],
  playful: ["#ffd23f", "#ff6f91", "#3ec1d3"],
};
const DEFAULT_SECTIONS = ["hero", "features", "about", "faq"];

let options = null, sites = [], current = null, busy = false, signedIn = false;
const wanted = Number(new URLSearchParams(location.search).get("site")) || null;

$("signin-here").addEventListener("click", () => openSignIn());

const optionsReady = api("/api/sites/options").then(r => {
  options = r.ok ? r.data : { ai: false, styles: [], sections: [], cost: { generate: 5, refine: 3 }, keep: 20 };
  document.querySelectorAll(".cost-generate").forEach(el => (el.textContent = options.cost.generate));
  document.querySelectorAll(".cost-refine").forEach(el => (el.textContent = options.cost.refine));
  $("keep").textContent = options.keep;
  $("ai-off").hidden = options.ai;
  $("styles").innerHTML = options.styles.map((s, i) => `
    <label class="sm-style">
      <input type="radio" name="style" value="${esc(s.id)}" ${i === 0 ? "checked" : ""}>
      <span class="sm-swatch" aria-hidden="true">${(SWATCH[s.id] ?? []).map(c => `<i style="background:${c}"></i>`).join("")}</span>
      <strong>${esc(s.name)}</strong>
      <span class="small">${esc(s.blurb)}</span>
    </label>`).join("");
  $("sections").innerHTML = options.sections.map(s => `
    <label class="sm-check"><input type="checkbox" name="sections" value="${esc(s.id)}" ${DEFAULT_SECTIONS.includes(s.id) ? "checked" : ""}> ${esc(s.name)}</label>`).join("");
  setBusy(false);
});

onUser(async user => {
  signedIn = !!user;
  $("signed-out").hidden = signedIn;
  $("maker").hidden = !signedIn;
  $("saved").hidden = !signedIn;
  if (!user?.ageGroup || user.ageGroup === "under13") return;
  await optionsReady;
  await loadList();
  if (current) return;
  const first = wanted && sites.some(s => s.id === wanted) ? wanted : sites[0]?.id;
  if (first) openSite(first);
});

// ---------- Form ----------
const form = $("site-form");
form.elements.description.addEventListener("input", e => {
  $("desc-count").textContent = `${e.target.value.length.toLocaleString()} / 2,000`;
});

function setBusy(on, text) {
  busy = on;
  const off = on || !options?.ai;
  $("generate").disabled = off;
  $("refine").disabled = off;
  $("instruction").disabled = on;
  $("delete").disabled = on;
  $("progress").hidden = !on;
  if (on) {
    $("empty").hidden = true;
    $("frame").hidden = true;
    $("progress-text").textContent = text;
  } else {
    $("frame").hidden = !current;
    $("empty").hidden = !!current;
  }
}

function formError(message) {
  $("form-error").textContent = message ?? "";
  $("form-error").hidden = !message;
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  if (busy) return;
  const f = form.elements;
  const body = {
    name: f.name.value.trim(),
    description: f.description.value.trim(),
    style: form.querySelector("[name=style]:checked")?.value,
    sections: [...form.querySelectorAll("[name=sections]:checked")].map(c => c.value),
  };
  if (!body.name) { formError("Give your site a name."); return f.name.focus(); }
  if (body.description.length < 10) { formError("Describe your site in a sentence or two (at least 10 characters)."); return f.description.focus(); }
  if (!body.sections.length) return formError("Pick at least one section.");
  formError(null);

  const stop = progress("Building your site");
  const r = await api("/api/sites/generate", { method: "POST", body });
  stop();
  if (!r.ok) return formError(r.data.error || "Something went wrong. Try again.");
  show(r.data.site);
  allowance(r.data.remaining);
  await loadList();
  toast("Your site is ready.");
});

// The page waits on one long request, so the message changes to show it's still working.
function progress(verb) {
  const started = Date.now();
  setBusy(true, `${verb}. This can take up to a minute.`);
  if (innerWidth < 900) $("preview-title").scrollIntoView({ behavior: "smooth", block: "start" });
  const timer = setInterval(() => {
    const s = Math.round((Date.now() - started) / 1000);
    $("progress-text").textContent = s < 20 ? `${verb}. This can take up to a minute.`
      : s < 50 ? `${verb}: writing the page and its styles (${s} seconds so far).`
      : `${verb}: nearly there (${s} seconds so far).`;
  }, 1000);
  return () => { clearInterval(timer); setBusy(false); };
}

function allowance(remaining) {
  if (typeof remaining !== "number") return;
  $("allowance").textContent = `Uses ${options.cost.generate} AI messages. You have ${remaining} left today.`;
}

// ---------- Preview ----------
function show(site) {
  current = site;
  // srcdoc in a sandbox with no permissions: no scripts, no forms, its own blank origin.
  $("frame").srcdoc = site.html;
  $("frame").hidden = false;
  $("empty").hidden = true;
  $("actions").hidden = false;
  $("refine-form").hidden = false;
  $("download").href = `/api/sites/${site.id}/download`;
  $("site-meta").textContent = `${site.name}, ${site.styleName}, ${date(site.createdAt)}`;
  $("preview-title").textContent = `Preview: ${site.name}`;
  markCurrent();
}

function clearPreview() {
  current = null;
  $("frame").removeAttribute("srcdoc");
  $("frame").hidden = true;
  $("empty").hidden = false;
  $("actions").hidden = true;
  $("refine-form").hidden = true;
  $("preview-title").textContent = "Preview";
}

document.querySelectorAll("[data-size]").forEach(b => b.addEventListener("click", () => {
  $("stage").dataset.size = b.dataset.size;
  document.querySelectorAll("button[data-size]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
}));

$("refine-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (busy || !current) return;
  const instruction = $("instruction").value.trim();
  if (!instruction) return $("instruction").focus();
  const stop = progress("Making your change");
  const r = await api(`/api/sites/${current.id}/refine`, { method: "POST", body: { instruction } });
  stop();
  if (!r.ok) return toast(r.data.error || "That change didn't work. Try again.");
  $("instruction").value = "";
  show(r.data.site);
  allowance(r.data.remaining);
  await loadList();
  toast("Change made. The old version is still in your list.");
});

$("delete").addEventListener("click", async () => {
  if (!current || busy) return;
  if (!confirm(`Delete "${current.name}"? This can't be undone.`)) return;
  const r = await api(`/api/sites/${current.id}`, { method: "DELETE" });
  if (!r.ok) return toast(r.data.error);
  clearPreview();
  await loadList();
  toast("Site deleted.");
});

// ---------- Saved sites ----------
async function loadList() {
  const r = await api("/api/sites");
  if (!r.ok) return;
  sites = r.data.sites;
  allowance(r.data.remaining);
  $("site-list").innerHTML = sites.length ? sites.map(s => `<li>
      <button class="sm-site" type="button" data-site="${s.id}">
        <strong>${esc(s.name)}</strong>
        <span class="small">${esc(s.styleName)}, ${when(s.createdAt)}</span>
      </button></li>`).join("")
    : `<li class="hint">No sites yet. Your first one will show up here.</li>`;
  $("site-list").querySelectorAll("[data-site]").forEach(b => b.addEventListener("click", () => openSite(Number(b.dataset.site), true)));
  markCurrent();
}

function markCurrent() {
  $("site-list").querySelectorAll("[data-site]").forEach(b =>
    b.setAttribute("aria-current", String(Number(b.dataset.site) === current?.id)));
}

async function openSite(id, scroll = false) {
  if (busy) return;
  const r = await api(`/api/sites/${id}`);
  if (!r.ok) return toast(r.data.error);
  show(r.data.site);
  if (scroll && innerWidth < 900) $("preview-title").scrollIntoView({ behavior: "smooth", block: "start" });
}
