// Pixel icons for creator badges and avatars, shared by /creators and /c/<handle>.
import { esc, icon, registerIcons } from "./common.js";

registerIcons({
  table: { c: { k: "#3a2410", T: "#c9a46a", t: "#a0682f", s: "#8e5426", g: "#8a8e96", G: "#5c5f66" }, m: [
    "kkkkkkkk", "kTTkTTTk", "kTtkTtTk", "kkkkkkkk", "ssssssss", "sgGssGgs", "sgssssgs", "ssssssss"] },
  upload: { c: { g: "#3bd16f", G: "#13843b", p: "#ede6d6", P: "#b9b1a0" }, m: [
    "...gg...", "..gggg..", ".gggggg.", "...gG...", "...gG...", "pppppppP", "pPPPPPPP", "PPPPPPPP"] },
  heart: { c: { r: "#e5463b", R: "#9b1c14", w: "#ffc2bb" }, m: [
    ".rr..rr.", "rwrrrrrr", "rwrrrrrR", "rrrrrrrR", ".rrrrrR.", "..rrrR..", "...rR...", "........"] },
  bell: { c: { k: "#5a3416", y: "#f2c230", Y: "#b8860b", w: "#fff3b0" }, m: [
    "...kk...", "..yyyy..", ".ywyyyY.", ".ywyyyY.", ".yyyyyY.", "yyyyyyYY", "YYYYYYYY", "...kk..."] },
  player: { c: { h: "#3b2414", s: "#c68e62", S: "#a8734b", w: "#ffffff", b: "#3b5bd6", m: "#6e4320" }, m: [
    "hhhhhhhh", "hhhhhhhh", "hsssssSh", "swbssbws", "sssSSsss", "ssmssmss", "ssmmmmss", "ssssssss"] },
});

export const BADGE_ICON = {
  maker: "table", pixel_artist: "painting", pack_builder: "chest", plugin_smith: "anvil",
  publisher: "upload", showcased: "frame", supporter: "heart", recruiter: "bell", donor: "emerald", game_launcher: "rocket",
};
export const badgeIcon = (key, label = "") => icon(BADGE_ICON[key] ?? "emerald", label);

// A creator's picture from their sign-in provider, or a pixel face.
export const avatar = picture => picture
  ? `<img src="${esc(picture)}" alt="" referrerpolicy="no-referrer">`
  : icon("player");

// One row of small badge slots, each named for screen readers and on hover.
export const badgeRow = (keys, info) => `<ul class="badge-row">${keys.map(k => {
  const b = info[k] ?? { name: k };
  return `<li class="badge-slot" title="${esc(b.name)}">${badgeIcon(k, esc(b.name))}</li>`;
}).join("")}</ul>`;

// Badges with their meaning, for the guide and a creator's page.
export const badgeList = (badges, cls = "") => `<ul class="badge-list ${cls}">${badges.map(b => `
  <li><span class="slot">${badgeIcon(b.key)}</span><span><strong>${esc(b.name)}</strong><span class="small">${esc(b.meaning)}</span></span></li>`).join("")}</ul>`;
