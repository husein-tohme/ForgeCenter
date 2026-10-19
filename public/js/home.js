import { api } from "./common.js";
import { repoCard } from "./cards.js";
const r = await api("/api/repos/explore");
const repos = r.data.repos ?? [];
document.getElementById("recent").innerHTML = repos.length ? repos.slice(0, 6).map(repoCard).join("")
  : `<div class="empty">No public repos yet. <a href="/new">Be the first</a>.</div>`;
