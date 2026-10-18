// Shared by the games pages (games.js, game.js, my-games.js): game icons, cards,
// the status pill and a confirm dialog. Choices come from /api/games/options.
import { coverUrl } from "./covers.js";
import { $, api, esc, icon, registerIcons, toast, getUser, date } from "./common.js";

// Game icons that common.js doesn't already draw (gamepad, diamond, grass, pickaxe, chest, rocket).
registerIcons({
  sword: { c: { w: "#e8e8e8", W: "#9a9a9a", g: "#6e4320", h: "#8b5a2b", k: "#3a3a3a" }, m: [
    "......Ww", ".....Ww.", "....Ww..", "..gWw...", "...g....", "..h.g...", ".h......", "k......."] },
  trophy: { c: { Y: "#f2c230", y: "#b8860b", w: "#fff6c8" }, m: [
    ".YYYYYY.", "Y.YwYy.Y", "Y.YYYy.Y", ".YYYYYy.", "...Yy...", "...Yy...", "..YYYy..", ".yyyyyy."] },
  potion: { c: { c: "#8b5a2b", g: "#d6ecff", r: "#e0457b", R: "#a3245a", w: "#ffffff" }, m: [
    "...cc...", "...gg...", "..gggg..", ".grwrrg.", ".grrrrg.", ".gRrrRg.", ".gRRRRg.", "..gggg.."] },
  heart: { c: { r: "#d9372b", R: "#8f1d14", w: "#ffb3ab" }, m: [
    "........", ".rr..rr.", "rwrrrrrr", "rrrrrrrR", ".rrrrrR.", "..rrrR..", "...rR...", "........"] },
  star: { c: { y: "#f2c230", Y: "#fff3b0", o: "#b8860b" }, m: [
    "...yy...", "...yy...", "yyyYYyyo", ".yyYYyo.", "..yyyo..", "..yyoo..", ".yo..yo.", ".o....o."] },
  castle: { c: { s: "#a5a5a5", S: "#6b6b6b", k: "#2e3035", d: "#6e4320" }, m: [
    "ss.ss.ss", "ssssssss", "sksssSks", "ssssssss", "sSssssSs", "sssddsss", "sssddsss", "SSSddSSS"] },
  map: { c: { b: "#7a5c2e", p: "#e8d9a8", g: "#5da33a", w: "#4a7bd6" }, m: [
    "bbbbbbbb", "bpppwwpb", "bpggwwpb", "bggggwpb", "bpgggwwb", "bppgwwpb", "bpppwppb", "bbbbbbbb"] },
  slime: { c: { G: "#3f8a3b", g: "#7fd16f", k: "#1e3d1c" }, m: [
    "GGGGGGGG", "GggggggG", "GkkggkkG", "GkkggkkG", "GggggggG", "GggkkggG", "GggggggG", "GGGGGGGG"] },
  tnt: { c: { r: "#d9372b", R: "#9b1c14", w: "#f4f4f4", k: "#2a2a2a", f: "#8b8b8b" }, m: [
    "rrRrrRrr", "rrRrrRrr", "wwwwwwww", "wkwkwwkw", "wkwkkwkw", "wwwwwwww", "rrRrrRrr", "RRRRRRRR"] },
  portal: { c: { o: "#1d1430", p: "#7b33c4", P: "#c27bff" }, m: [
    "oooooooo", "oPppPppo", "opPppPpo", "oppPppPo", "oPppPppo", "opPppPpo", "oppPppPo", "oooooooo"] },
});

const ICON_KEYS = ["gamepad", "sword", "trophy", "potion", "heart", "star", "castle", "map",
  "slime", "tnt", "diamond", "grass", "pickaxe", "chest", "rocket", "portal"];
const ACCENT_KEYS = ["emerald", "lapis", "redstone", "gold", "amethyst", "copper", "diamond", "slate"];
// Only known names reach the page, even in class names.
export const gameIcon = (name, label = "") => icon(ICON_KEYS.includes(name) ? name : "gamepad", label);
export const accentClass = key => `accent-${ACCENT_KEYS.includes(key) ? key : "emerald"}`;

let optionsPromise;
export const getOptions = () => optionsPromise ??= api("/api/games/options").then(r => (r.ok ? r.data : null));
export const nameOf = (list, key) => list?.find(x => x.key === key)?.name ?? key;

// Play buttons: a Minecraft server's address to copy, and/or a link to play or download.
export function playActions(g, { big = false } = {}) {
  const size = big ? "" : " btn-small";
  const parts = [];
  if (g.serverAddress) {
    parts.push(`<code class="address lp-address">${esc(g.serverAddress)}</code>`,
      `<button class="btn btn-buy${size}" type="button" data-copy="${esc(g.serverAddress)}">Copy address</button>`);
  }
  if (g.playUrl) {
    parts.push(`<a class="btn${g.serverAddress ? "" : " btn-buy"}${size}" href="${esc(g.playUrl)}" target="_blank" rel="noopener nofollow ugc">${g.serverAddress ? "Website" : big ? "Play now" : "Play"}</a>`);
  }
  return parts.join("");
}

export const tagList = (tags, opts) => tags?.length
  ? `<ul class="lp-tags" aria-label="Tags">${tags.map(t => `<li>${esc(nameOf(opts?.tags, t))}</li>`).join("")}</ul>` : "";

// An 18+ game, as teens and visitors see it (like an age-restricted channel).
export const restrictedCard = () => `
  <article class="panel lp-card restricted">
    <span class="gate-icon">${icon("barrier")}</span>
    <h3>Age-restricted game</h3>
    <p>This game is for adults (18+). ${getUser()
      ? "Your account is in the teen group. If that isn't right, confirm you're an adult."
      : "Sign in and confirm you're an adult to see it."}</p>
    <button class="btn btn-small" type="button" data-confirm-age>Confirm age</button>
  </article>`;

// A game as it appears on the games page. preview: the editor's live preview, with no links to it.
export function gameCard(g, opts, { preview = false } = {}) {
  if (g.restricted) return restrictedCard();
  const href = `/game?id=${encodeURIComponent(g.id)}`;
  const title = esc(g.title || "Your game");
  return `
    <article class="panel lp-card ${accentClass(g.accent)}">
      <img class="lp-cover" src="${coverUrl({ id: g.id ?? 0, accent: g.accent, title: g.title || "" })}" alt="" width="320" height="180">
      <div class="lp-card-head">
        <span class="slot lp-icon">${gameIcon(g.icon)}</span>
        <div class="lp-card-name">
          <h3>${preview ? title : `<a href="${href}">${title}</a>`}</h3>
          <span class="small">${esc(nameOf(opts?.platforms, g.platform))}${g.creator ? `, by ${esc(g.creator)}` : ""}</span>
        </div>
        ${g.adultOnly ? `<span class="pill pill-adult">18+</span>` : ""}
      </div>
      ${g.tagline ? `<p class="lp-tagline">${esc(g.tagline)}</p>` : ""}
      ${tagList(g.tags, opts)}
      <div class="lp-actions">${playActions(g)}${preview ? "" : `<a class="btn btn-small" href="${href}">Details</a>`}</div>
    </article>`;
}

// Where a game is, as its creator sees it.
export function statusInfo(g) {
  const until = g.periodEnd ? date(g.periodEnd) : null;
  return {
    draft: { label: "Draft", tone: "muted", help: "Not on the games page yet." },
    checkout: { label: "Waiting for payment", tone: "wait", help: "Checkout isn't finished. Press Launch to try again." },
    live: { label: "Live", tone: "done", help: `On the games page.${until ? ` Renews for $1 on ${until}.` : ""}` },
    ending: { label: until ? `Live until ${until}` : "Live until the paid month ends", tone: "wait",
      help: `Canceled. It stays on the games page until ${until ?? "the end of the month you've paid for"}, then comes off.` },
    overdue: { label: "Payment overdue", tone: "bad", help: "Your last payment didn't go through, so it's off the games page. Update your card to bring it back." },
    ended: { label: "Launch ended", tone: "muted", help: "Off the games page. Launch it again whenever you like." },
    hidden: { label: "Taken down", tone: "bad", help: "ForgeCenter took this game off the games page. Open a support ticket if you think that's a mistake." },
  }[g.status] ?? { label: g.status, tone: "muted", help: "" };
}
export const statusPill = g => { const s = statusInfo(g); return `<span class="pill pill-${s.tone}">${esc(s.label)}</span>`; };

// A yes/no question in an inventory-style dialog. bodyHtml must already be escaped.
export function confirmDialog({ title, bodyHtml, confirm, cancel = "Go back", danger = false, iconName = null }) {
  $("lp-confirm")?.remove();
  document.body.insertAdjacentHTML("beforeend", `
    <dialog class="panel gate lp-confirm" id="lp-confirm" aria-labelledby="lp-confirm-title">
      ${iconName ? `<span class="gate-icon">${icon(iconName)}</span>` : ""}
      <h2 id="lp-confirm-title">${esc(title)}</h2>
      ${bodyHtml}
      <div class="lp-confirm-actions">
        <button class="btn ${danger ? "btn-danger" : "btn-buy"}" type="button" value="yes">${esc(confirm)}</button>
        <button class="btn" type="button" value="">${esc(cancel)}</button>
      </div>
    </dialog>`);
  const d = $("lp-confirm");
  return new Promise(resolve => {
    d.addEventListener("click", e => { const b = e.target.closest("button[value]"); if (b) d.close(b.value); });
    d.addEventListener("close", () => { resolve(d.returnValue === "yes"); d.remove(); });
    d.showModal();
  });
}

// Any [data-copy] button copies its text, for server addresses.
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  try {
    await navigator.clipboard.writeText(b.dataset.copy);
    toast("Address copied. In Minecraft, open Multiplayer, choose Add Server and paste it.");
  } catch {
    toast(`Copy this address into Minecraft: ${b.dataset.copy}`);
  }
});
