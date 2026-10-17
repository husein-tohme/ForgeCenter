// The public games page: live games, a platform filter and search.
import { $, api, esc, icon, onUser, ready } from "./common.js";
import { getOptions, gameCard } from "./launchpad.js";

const params = new URLSearchParams(location.search);
let platform = params.get("platform") ?? "";
let q = params.get("q") ?? "";
$("q").value = q;

const opts = await getOptions();
if (opts && !opts.platforms.some(p => p.key === platform)) platform = "";

function renderChips() {
  const chips = [{ key: "", name: "All games" }, ...(opts?.platforms ?? [])];
  $("platforms").innerHTML = chips.map(p =>
    `<button class="tool" type="button" data-platform="${esc(p.key)}" aria-pressed="${p.key === platform}">${esc(p.name)}</button>`).join("");
}
renderChips();

$("platforms").addEventListener("click", e => {
  const b = e.target.closest("[data-platform]");
  if (!b || b.dataset.platform === platform) return;
  platform = b.dataset.platform;
  renderChips();
  load();
});
$("search-form").addEventListener("submit", e => {
  e.preventDefault();
  q = $("q").value.trim();
  load();
});
// Clearing the search box (its x button) shows everything again.
$("q").addEventListener("search", () => { if (!$("q").value && q) { q = ""; load(); } });

let run = 0;
async function load() {
  const mine = ++run;
  const qs = new URLSearchParams();
  if (platform) qs.set("platform", platform);
  if (q) qs.set("q", q);
  history.replaceState(null, "", location.pathname + (qs.size ? `?${qs}` : ""));
  $("games").setAttribute("aria-busy", "true");
  const r = await api(`/api/games${qs.size ? `?${qs}` : ""}`);
  if (mine !== run) return;
  $("games").removeAttribute("aria-busy");
  if (!r.ok) {
    $("result-count").textContent = "";
    $("games").innerHTML = `<p class="error">${esc(r.data.error || "Games couldn't load. Refresh the page to try again.")}</p>`;
    return;
  }
  const games = r.data.games;
  const filtered = platform || q;
  $("result-count").textContent = games.length
    ? `${games.length === 60 ? "The newest 60" : games.length} game${games.length === 1 ? "" : "s"}${filtered ? " found" : ""}.`
    : "";
  $("games").innerHTML = games.length ? games.map(g => gameCard(g, opts)).join("") : filtered
    ? `<div class="panel empty lp-empty"><div><p>No games match that. Try another platform or a different search.</p>
        <button class="btn" type="button" id="clear-filters">Show all games</button></div></div>`
    : `<div class="panel empty lp-empty"><span class="empty-icon">${icon("arcade")}</span>
        <div><p>No games have launched yet. Made one? Be the first on this page.</p>
        <a class="btn btn-buy" href="/my-games">Launch your game</a></div></div>`;
  $("clear-filters")?.addEventListener("click", () => {
    platform = ""; q = ""; $("q").value = "";
    renderChips(); load();
  });
}

// 18+ games show as placeholders until someone signs in as a confirmed adult.
await ready;
let seen = null;
onUser(user => {
  const key = user ? `${user.id}:${user.ageGroup}` : "";
  if (key === seen) return;
  seen = key;
  load();
});
