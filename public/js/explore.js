import { $, api } from "./common.js";
import { repoCard } from "./cards.js";
const form = $("search");
const params = new URLSearchParams(location.search);
form.q.value = params.get("q") ?? "";
form.sort.value = params.get("sort") ?? "new";
async function load() {
  const r = await api(`/api/repos/explore?q=${encodeURIComponent(form.q.value)}&sort=${form.sort.value}`);
  const repos = r.data.repos ?? [];
  $("results").innerHTML = repos.length ? repos.map(repoCard).join("") : `<div class="empty">No repos match that yet.</div>`;
}
form.addEventListener("submit", e => {
  e.preventDefault();
  history.replaceState(null, "", `?q=${encodeURIComponent(form.q.value)}&sort=${form.sort.value}`);
  load();
});
load();
