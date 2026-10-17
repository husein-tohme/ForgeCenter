// One game's public page (/game?id=). Its creator also sees where the launch is, and the
// site owner can take the game down from here.
import { $, api, esc, icon, date, toast, onUser, ready } from "./common.js";
import { getOptions, gameIcon, accentClass, playActions, tagList, nameOf, statusPill, statusInfo, confirmDialog } from "./launchpad.js";

const id = Number(new URLSearchParams(location.search).get("id")) || null;
const opts = await getOptions();

const message = (title, text, action = `<a class="btn btn-buy" href="/games">See all games</a>`) => `
  <section class="panel empty lp-empty">
    <span class="empty-icon">${icon("barrier")}</span>
    <div><h1 class="lp-message-title">${esc(title)}</h1><p>${esc(text)}</p>${action}</div>
  </section>`;

const hostOf = link => { try { return new URL(link).hostname; } catch { return ""; } };

function render({ game: g, mine, canModerate }) {
  if (g.restricted) {
    document.title = "Age-restricted game · ForgeCenter";
    $("game").innerHTML = `
      <section class="panel lp-card restricted lp-restricted-page">
        <span class="gate-icon">${icon("barrier")}</span>
        <h1 class="lp-message-title">Age-restricted game</h1>
        <p>This game is for adults (18+). Sign in and confirm you're an adult to see it. If your account is in the teen group by mistake, you can confirm your age with a credit card check or an ID scan.</p>
        <button class="btn btn-buy" type="button" data-confirm-age>Confirm age</button>
      </section>`;
    return;
  }
  document.title = `${g.title} · ForgeCenter`;
  const platform = nameOf(opts?.platforms, g.platform);
  const server = !!g.serverAddress;
  $("game").innerHTML = `
    <article class="lp-detail ${accentClass(g.accent)}">
      <header class="panel lp-detail-head">
        <span class="slot lp-icon-big">${gameIcon(g.icon)}</span>
        <div class="lp-detail-name">
          <h1 class="page-title">${esc(g.title)}</h1>
          ${g.tagline ? `<p class="lp-detail-tagline">${esc(g.tagline)}</p>` : ""}
          <p class="small">${esc(platform)}${g.creator ? `, by ${esc(g.creator)}` : ""}${g.launchedAt ? `. On ForgeCenter since ${date(g.launchedAt)}` : ""}
            ${g.adultOnly ? ` <span class="pill pill-adult">18+</span>` : ""}</p>
          ${tagList(g.tags, opts)}
        </div>
      </header>

      ${mine ? `
      <section class="panel lp-owner-note">
        <div><p><strong>This is your game.</strong> ${statusPill(g)}</p><p class="small">${esc(statusInfo(g).help)}</p></div>
        <a class="btn" href="/my-games?edit=${g.id}">Edit in My games</a>
      </section>` : ""}

      <div class="lp-detail-grid">
        <section class="panel lp-play" aria-labelledby="play-title">
          <h2 id="play-title">${server ? "Join the server" : "Play"}</h2>
          ${server ? `<p>In Minecraft, open Multiplayer, choose Add Server and paste this address.</p>` : ""}
          <div class="lp-play-actions">${playActions(g, { big: true })}</div>
          ${g.playUrl ? `<p class="small">${server ? "The website" : "Play now"} opens ${esc(hostOf(g.playUrl))} in a new tab. It isn't run by ForgeCenter.</p>` : ""}
          ${g.trailerUrl ? `<p><a class="lp-trailer" href="${esc(g.trailerUrl)}" target="_blank" rel="noopener nofollow ugc">${icon("monitor")}Watch the trailer on YouTube</a></p>` : ""}
        </section>
        <section class="panel lp-about" aria-labelledby="about-title">
          <h2 id="about-title">About this game</h2>
          ${g.description ? `<div class="lp-description">${esc(g.description)}</div>` : `<p class="hint">The creator hasn't written a description yet.</p>`}
        </section>
      </div>

      ${canModerate ? `
      <section class="panel lp-moderate" aria-labelledby="mod-title">
        <h2 id="mod-title">Owner tools</h2>
        <p>${g.hidden ? "This game is taken down: nobody else can see it." : g.live ? "This game is on the games page." : "This game isn't on the games page (it's a draft or its launch ended)."}</p>
        <button class="btn ${g.hidden ? "btn-buy" : "btn-danger"}" type="button" id="toggle-hidden">${g.hidden ? "Put it back" : "Take it down"}</button>
      </section>` : ""}
    </article>`;

  $("toggle-hidden")?.addEventListener("click", async () => {
    const hide = !g.hidden;
    if (hide && !await confirmDialog({ title: `Take down ${g.title}?`, iconName: "barrier", danger: true, confirm: "Take it down",
      bodyHtml: `<p>It comes off the games page straight away. Its creator still sees it in My games, marked as taken down, and their subscription keeps running until they cancel it.</p>` })) return;
    const r = await api(`/api/admin/games/${g.id}`, { method: "PATCH", body: { hidden: hide } });
    if (!r.ok) return toast(r.data.error);
    toast(hide ? "Game taken down." : "Game is back up.");
    load();
  });
}

async function load() {
  if (!id) {
    $("game").innerHTML = message("Pick a game", "This link doesn't say which game to show. Find one on the games page.");
    return;
  }
  const r = await api(`/api/games/${id}`);
  if (r.status === 404) {
    document.title = "Game not found · ForgeCenter";
    $("game").innerHTML = message("That game isn't here right now", "It may have been taken off the games page by its creator, or the link is wrong.");
    return;
  }
  if (!r.ok) {
    $("game").innerHTML = `<p class="error">${esc(r.data.error || "This game couldn't load. Refresh the page to try again.")}</p>`;
    return;
  }
  render(r.data);
}

// Load again when someone signs in or out: drafts, 18+ games and owner tools depend on who's looking.
await ready;
let seen = null;
onUser(user => {
  const key = user ? `${user.id}:${user.ageGroup}` : "";
  if (key === seen) return;
  seen = key;
  load();
});
