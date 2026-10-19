import { $, api, esc, money, openReport, openSignIn, getUser, getConfig, onUser, toast } from "./common.js";
import { repoCard, productCard } from "./cards.js";
const username = decodeURIComponent(location.pathname.slice(1));
onUser(async () => {
  const [r, s] = await Promise.all([api(`/api/repos/user/${encodeURIComponent(username)}`), api(`/api/store/products?user=${encodeURIComponent(username)}`)]);
  if (!r.ok) { $("profile").innerHTML = `<div class="empty"><h1>Not found</h1><p>${esc(r.data.error)}</p></div>`; return; }
  const u = r.data.user, products = s.data.products ?? [];
  $("profile").innerHTML = `<aside>
      ${u.picture ? `<img class="avatar-lg" src="${esc(u.picture)}" alt="${esc(u.name)}'s picture" referrerpolicy="no-referrer">` : `<div class="avatar-lg" style="background:var(--surface-3)" aria-hidden="true"></div>`}
      <h1>${esc(u.name)}</h1><div class="handle">@${esc(u.username)}</div>
      ${u.bio ? `<p>${esc(u.bio)}</p>` : ""}
      ${u.website ? `<p><a href="${esc(u.website)}" rel="nofollow noopener" target="_blank">${esc(u.website.replace(/^https?:\/\//, ""))}</a></p>` : ""}
      <p class="small muted">Joined ${new Date(u.joinedAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</p>
      <div class="row">${r.data.self ? `<a class="btn btn-small" href="/settings">Edit profile</a>` : `${u.canSell ? `<button class="btn btn-small btn-primary" id="donate">♥ Donate</button>` : ""}<button class="btn btn-small" id="report">Report</button>`}</div>
    </aside>
    <div>
      ${products.length ? `<h2>For sale</h2><div class="grid" style="margin-bottom:28px">${products.map(productCard).join("")}</div>` : ""}
      <div class="row spread"><h2>Repos <span class="pill">${r.data.repos.length}</span></h2>${r.data.self ? `<a class="btn btn-small btn-primary" href="/new">+ New repo</a>` : ""}</div>
      <div class="grid">${r.data.repos.map(repoCard).join("") || `<div class="empty">No public repos yet.</div>`}</div>
    </div>`;
  $("report")?.addEventListener("click", () => openReport("user", u.username));
  $("donate")?.addEventListener("click", async () => {
    if (!getUser()) return openSignIn();
    if (!getConfig().payments) return toast("Payments open soon.");
    const dollars = Number(prompt(`How much would you like to give @${u.username}? ($1 to $500)`, "5"));
    if (!dollars) return;
    const x = await api(`/api/store/donate/${encodeURIComponent(u.username)}`, { method: "POST", body: { amountCents: Math.round(dollars * 100) } });
    if (x.ok) location.assign(x.data.url); else toast(x.data.error);
  });
});
