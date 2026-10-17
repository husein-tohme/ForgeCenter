// Pixel avatars for AI Maker assistants, shared by the builder and the shared chat page.
// The names match AVATARS in src/aimaker.js, which only accepts these.
import { icon, registerIcons } from "./common.js";

export const AVATARS = {
  robot: { label: "Robot", c: { k: "#2e3035", g: "#8a8e96", G: "#c9ccd2", c: "#4ee2ec", r: "#d9372b" }, m: [
    "...rr...", "...kk...", "kkkkkkkk", "kGGGGGGk", "kGcGGcGk", "kGGGGGGk", "kGkkkkGk", "kkkkkkkk"] },
  wizard: { label: "Wizard", c: { p: "#5b3a91", P: "#9b6fd9", y: "#f2c230", s: "#e0ac69", k: "#2a1846", w: "#f0f0f0" }, m: [
    "...pp...", "..pPpp..", ".ppypPp.", "pppppppp", ".ssssss.", ".skssks.", ".wwwwww.", "..wwww.."] },
  knight: { label: "Knight", c: { r: "#d9372b", a: "#8a8e96", A: "#c9ccd2", k: "#2e3035" }, m: [
    "...rr...", "..rrr...", ".aaaaaa.", "aAAAAAAa", "akkkkkka", "aAAkkAAa", "aAAAAAAa", ".aaaaaa."] },
  cat: { label: "Cat", c: { o: "#d9822b", O: "#f2b25c", k: "#2e1a0a", p: "#f29bb0", w: "#ffffff" }, m: [
    "o......o", "oo....oo", "oooooooo", "oOkOOkOo", "oOOOOOOo", "wOOppOOw", ".oOOOOo.", "..oooo.."] },
  fox: { label: "Fox", c: { f: "#d9622b", F: "#f08a4b", w: "#f5f0e6", k: "#2e1a0a" }, m: [
    "ff....ff", "fFf..fFf", "ffffffff", "fkffffkf", "wwffffww", "wwwkkwww", ".wwwwww.", "..wwww.."] },
  slime: { label: "Slime", c: { d: "#3d8a2a", g: "#6cc04a", G: "#a5e888", k: "#1f3d14" }, m: [
    "dddddddd", "dGGGgggd", "dGgggggd", "dgkggkgd", "dgkggkgd", "dggggggd", "dggkkggd", "dddddddd"] },
  ghost: { label: "Ghost", c: { w: "#f4f4f8", W: "#c9c9d6", k: "#2e3035" }, m: [
    "..wwww..", ".wwwwww.", "wwkwwkww", "wwkwwkww", "wwwwwwww", "wwwWWwww", "wwwwwwww", "ww.ww.ww"] },
  owl: { label: "Owl", c: { b: "#7a4a22", B: "#b97a3f", y: "#f2c230", k: "#2e1a0a", o: "#e08a2e" }, m: [
    "b......b", "bb....bb", "bbbbbbbb", "byybbyyb", "bykbbkyb", "bBBooBBb", "bBBBBBBb", ".b.bb.b."] },
  star: { label: "Star", c: { y: "#f2c230", Y: "#fff2a8", d: "#b8860b" }, m: [
    "...yy...", "...yy...", "yyyYYyyy", ".yyYYyd.", "..yyyd..", ".yyyyyd.", ".yd..yd.", "yd....yd"] },
  heart: { label: "Heart", c: { r: "#d9372b", R: "#ff8a7e", d: "#8e1f17" }, m: [
    "........", ".rr..rr.", "rRRrrrrr", "rRrrrrrr", "rrrrrrrd", ".rrrrrd.", "..rrrd..", "...rd..."] },
};

registerIcons(Object.fromEntries(Object.entries(AVATARS).map(([k, v]) => [`av-${k}`, { c: v.c, m: v.m }])));

// Unknown names (say, from an older page) fall back to the robot.
export const avatarIcon = (name, label = "") => icon(`av-${AVATARS[name] ? name : "robot"}`, label);
export const avatarLabel = name => AVATARS[name]?.label ?? "Robot";
