// Drawn pixel-art covers for games that don't have their own art yet. Each game gets
// its own scene from its id and accent colour (night sky, stars, hills, a landmark),
// so rows never show a generic icon. Drawn at 64x36 and scaled up crisply.
const ACCENTS = {
  emerald: ["#0d3b22", "#17a34a", "#4fd47e"], lapis: ["#101d4a", "#2546a8", "#5a78d0"],
  redstone: ["#3b0c08", "#c0281c", "#e8645a"], gold: ["#3d2d05", "#e5b31f", "#ffe27a"],
  amethyst: ["#26123d", "#8a4fd1", "#b98af0"], copper: ["#3a1a0c", "#c8693c", "#eb9a70"],
  diamond: ["#08353a", "#26b3bf", "#7ae6ee"], slate: ["#15171b", "#4a4f58", "#7d838e"],
};
const cache = new Map();

// A small seeded random, so a game's cover is the same on every visit.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const seedOf = str => [...String(str)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

export function coverUrl(game) {
  const key = `${game.id}:${game.accent}:${game.title}`;
  if (cache.has(key)) return cache.get(key);
  const [deep, mid, hi] = ACCENTS[game.accent] ?? ACCENTS.emerald;
  const W = 64, H = 36, r = rng(seedOf(key));
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const px = (x, y, w, h, color) => { g.fillStyle = color; g.fillRect(x, y, w, h); };

  // Sky in three bands, darkest at the top.
  px(0, 0, W, H, "#07080c");
  px(0, 8, W, 10, deep);
  px(0, 18, W, H, mid);
  for (let i = 0; i < 26; i++) px(Math.floor(r() * W), Math.floor(r() * 14), 1, 1, r() > .8 ? hi : "#e9e5dc");
  // A moon or sun.
  const mx = 6 + Math.floor(r() * 50);
  px(mx, 3, 4, 4, "#f3efe6"); px(mx + 1, 4, 2, 2, "#d9d3c4");

  // Two rows of blocky hills.
  let y = 20 + Math.floor(r() * 4);
  for (let x = 0; x < W; x += 2) {
    if (r() > .6) y += r() > .5 ? 1 : -1;
    y = Math.min(26, Math.max(16, y));
    px(x, y, 2, H - y, deep);
  }
  y = 27 + Math.floor(r() * 3);
  for (let x = 0; x < W; x += 2) {
    if (r() > .55) y += r() > .5 ? 1 : -1;
    y = Math.min(32, Math.max(25, y));
    px(x, y, 2, 1, "#5da33a"); px(x, y + 1, 2, H - y, "#6b4a2b");
  }

  // A landmark: a tower, a tree or a house, chosen by the seed.
  const lx = 8 + Math.floor(r() * 44), kind = Math.floor(r() * 3), base = 27;
  if (kind === 0) { px(lx, base - 12, 5, 12, "#8a8e96"); px(lx + 1, base - 9, 1, 2, "#ffd34d"); px(lx + 3, base - 5, 1, 2, "#ffd34d"); px(lx - 1, base - 13, 7, 2, "#5c616a"); }
  else if (kind === 1) { px(lx + 2, base - 5, 2, 5, "#6b4a2b"); px(lx, base - 11, 6, 6, "#2f7432"); px(lx + 1, base - 13, 4, 2, "#3f9a43"); }
  else { px(lx, base - 6, 8, 6, "#a07a50"); px(lx - 1, base - 8, 10, 2, "#7a2a20"); px(lx + 3, base - 3, 2, 3, "#2a1a0e"); px(lx + 6, base - 5, 1, 1, "#ffd34d"); }

  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}
