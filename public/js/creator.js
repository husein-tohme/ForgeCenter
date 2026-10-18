import { $, api, esc, icon, toast, ready, onUser } from "./common.js";
import { avatar, badgeList, badgeRow } from "./creator-badges.js";
import { reportButton } from "./report.js";

// The page lives at /c/<handle>.
const handle = (() => { try { return decodeURIComponent(location.pathname.split("/")[2] ?? "").toLowerCase(); } catch { return ""; } })();
const KINDS = { mod: ["pickaxe", "Mod"], texturepack: ["painting", "Texture pack"], modpack: ["chest", "Modpack"], plugin: ["anvil", "Server plugin"] };
const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
const monthYear = iso => new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
// Creator links lead off the site, so they open in a new tab without passing on who sent them.
const OUT = `target="_blank" rel="noopener nofollow ugc"`;

async function load() {
  const r = handle ? await api(`/api/creators/${encodeURIComponent(handle)}`) : { ok: false, data: {} };
  if (!r.ok) return notFound(r.data.error);
  render(r.data.creator);
}

function notFound(message) {
  $("creator").innerHTML = `
    <div class="not-found">
      <span class="slot not-found-slot">${icon("barrier")}</span>
      <div><h1 class="page-title">No creator page here</h1>
        <p>${esc(message || "Check the link, or find creators on the creators page.")}</p>
        <a class="btn" href="/creators">Find creators</a></div>
    </div>`;
}

function render(c) {
  const info = Object.fromEntries(c.badges.map(b => [b.key, b]));
  const name = esc(c.name);
  $("creator").innerHTML = `
    ${c.hidden ? `<p class="note">${c.isOwner
      ? `ForgeCenter has hidden your page, so only you can see it. If you think that's a mistake, <a href="/support">open a help ticket</a>.`
      : "This page is hidden. Only its creator and the site owner can see it."}</p>` : ""}
    <section class="panel creator-hero">
      <span class="slot creator-avatar">${avatar(c.picture)}</span>
      <div class="creator-who">
        <h1 class="page-title">${name}</h1>
        <p class="small">@${esc(c.handle)}, member since ${esc(monthYear(c.memberSince))}${c.isOwner || c.hidden ? "" : ` ${reportButton("creator", c.handle)}`}</p>
        ${c.badges.length ? badgeRow(c.badges.map(b => b.key), info) : ""}
      </div>
      ${c.isOwner || c.canModerate ? `<div class="creator-actions">
        ${c.isOwner ? `<a class="btn" href="/creators#yours">Edit your page</a>` : ""}
        ${c.canModerate && !c.isOwner ? `<button class="btn btn-small${c.hidden ? "" : " btn-danger"}" type="button" id="moderate">${c.hidden ? "Show this page" : "Hide this page"}</button>` : ""}
      </div>` : ""}
    </section>

    <div class="creator-layout">
      <div class="creator-main">
        <section class="panel">
          <h2 class="panel-title">About</h2>
          ${c.bio ? `<p class="bio">${esc(c.bio)}</p>` : `<p class="hint">${name} hasn't written anything here yet.</p>`}
        </section>

        ${c.creations.length ? `<section class="creator-section">
          <h2>On Modrinth</h2>
          <ul class="mod-list">${c.creations.map(m => {
            const [kindIcon, label] = KINDS[m.kind] ?? KINDS.mod;
            return `<li><span class="mod-icon">${icon(kindIcon)}</span><strong>${esc(m.name)}</strong>
              <span class="small">${label}</span><a href="${esc(m.url)}" ${OUT}>View on Modrinth</a></li>`;
          }).join("")}</ul>
        </section>` : ""}

        ${c.listings.length ? `<section class="creator-section">
          <h2>In the showcase</h2>
          <div class="listings">${c.listings.map(l => `
            <a class="panel listing" href="${esc(l.url)}" ${OUT}>
              <h3>${esc(l.title)}</h3><p>${esc(l.description)}</p>
              <span class="small">${esc(hostOf(l.url))}</span>${l.adultOnly ? ` <span class="pill pill-adult">18+</span>` : ""}
            </a>`).join("")}</div>
        </section>` : ""}

        <section class="creator-section">
          <h2>Badges</h2>
          ${c.badges.length ? badgeList(c.badges) : `<p class="hint">No badges yet. They appear as ${name} makes things with ForgeCenter's <a href="/#tools">free tools</a>.</p>`}
        </section>
      </div>

      <aside class="side-stack">
        ${c.payLinks?.length ? `<section class="panel support-panel">
          <h2 class="panel-title">Buy from ${name}</h2>
          <ul class="support-list">${c.payLinks.map(p => `
            <li><a class="btn btn-buy support-btn" href="/pay?l=${p.id}"><span class="btn-icon">${icon("emerald")}</span>${esc(p.title)}: $${(p.amount / 100).toFixed(2)}</a>
              ${p.description ? `<span class="small">${esc(p.description)}</span>` : ""}</li>`).join("")}</ul>
          <p class="small">Paid securely through Stripe, straight to ${name}.</p>
        </section>` : ""}

        ${c.support.length ? `<section class="panel support-panel">
          <h2 class="panel-title">Support ${name}</h2>
          <ul class="support-list">${c.support.map(s => `
            <li><a class="btn btn-buy support-btn" href="${esc(s.url)}" ${OUT}><span class="btn-icon">${icon("emerald")}</span>${esc(s.label)}</a>
              <span class="small">${esc(hostOf(s.url))}</span></li>`).join("")}</ul>
          <p class="small">You pay ${name} directly on that site. ForgeCenter doesn't handle this money and can't refund it.</p>
        </section>` : ""}

        <section class="panel" id="repos" hidden></section>

        ${c.links.length ? `<section class="panel">
          <h2 class="panel-title">Links</h2>
          <ul class="link-list">${c.links.map(l => `
            <li><a href="${esc(l.url)}" ${OUT}>${esc(l.label)}</a><span class="small">${esc(hostOf(l.url))}</span></li>`).join("")}</ul>
        </section>` : ""}

        <p class="small">Something wrong with this page? <a href="/support">Tell us on the help page</a>.</p>
      </aside>
    </div>`;

  $("moderate")?.addEventListener("click", async e => {
    e.target.disabled = true;
    const r = await api(`/api/admin/creators/${encodeURIComponent(c.handle)}`, { method: "PATCH", body: { hidden: !c.hidden } });
    e.target.disabled = false;
    if (!r.ok) return toast(r.data.error);
    toast(r.data.creator.hidden ? "Page hidden. It's out of the directory and its link shows not found." : "Page is visible again.");
    load();
  });
}

// Load once the session is known, and again if someone signs in or out here
// (confirmed adults see 18+ showcase listings; owners see their edit button).
ready.then(() => {
  let shownFor;
  onUser(user => {
    const id = user?.id ?? 0;
    if (id === shownFor) return;
    shownFor = id;
    load();
  });
});

// ---------- GitHub repos (src/github-repos.js) ----------
async function loadRepos(handle) {
  const box = document.getElementById("repos");
  if (!box) return;
  const r = await api(`/api/creators/${encodeURIComponent(handle)}/repos`);
  if (!r.ok || !r.data.github) return;
  const { github, repos } = r.data;
  box.innerHTML = `<h2 class="panel-title">On GitHub</h2>
    ${repos.length ? `<ul class="repo-list">${repos.map(x => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener nofollow ugc">${esc(x.name)}</a>
      ${x.description ? `<span class="small">${esc(x.description)}</span>` : ""}
      <span class="small">${x.language ? esc(x.language) + " · " : ""}★ ${x.stars}</span></li>`).join("")}</ul>` : `<p class="small">No public repos to show right now.</p>`}
    <a class="small" href="https://github.com/${encodeURIComponent(github)}" target="_blank" rel="noopener nofollow ugc">github.com/${esc(github)}</a>`;
  box.hidden = false;
}
