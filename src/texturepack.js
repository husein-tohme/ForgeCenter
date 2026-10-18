// Texture Forge: turns 16x16 drawings into a Minecraft Java resource pack.

// Vanilla textures people can replace. Only untinted, single-image textures so
// what you draw is exactly what you see in game.
export const TEXTURE_TARGETS = {
  item: [
    "diamond_sword", "diamond_pickaxe", "diamond_axe", "diamond_shovel", "iron_sword", "netherite_sword",
    "wooden_sword", "apple", "golden_apple", "bread", "cookie", "diamond", "emerald", "gold_ingot",
    "iron_ingot", "stick", "ender_pearl", "totem_of_undying", "nether_star", "experience_bottle",
    "iron_pickaxe", "golden_sword", "stone_sword", "bow", "arrow", "carrot", "golden_carrot", "cake",
    "egg", "feather", "flint", "coal", "redstone", "lapis_lazuli", "quartz", "slime_ball", "snowball",
    "book", "paper", "bucket", "water_bucket", "map", "shears", "bone", "string",
  ],
  block: [
    "dirt", "stone", "cobblestone", "oak_planks", "bricks", "sand", "gravel", "obsidian", "glass",
    "diamond_ore", "diamond_block", "emerald_block", "gold_block", "iron_block", "netherrack",
    "end_stone", "tnt_side", "crafting_table_front", "bookshelf",
    "oak_log", "birch_planks", "spruce_planks", "stone_bricks", "mossy_cobblestone", "coal_ore", "iron_ore",
    "gold_ore", "redstone_ore", "lapis_ore", "emerald_ore", "redstone_block", "lapis_block", "coal_block",
    "clay", "snow", "ice", "glowstone", "soul_sand", "sponge", "pumpkin_side", "melon_side", "furnace_front",
    "white_wool", "red_wool", "blue_wool", "black_wool", "terracotta", "quartz_block_side", "amethyst_block",
  ],
};
const VALID = new Set(Object.entries(TEXTURE_TARGETS).flatMap(([kind, names]) => names.map(n => `${kind}/${n}`)));

// pack_format for every Java version that has resource packs (1.6.1 onwards), newest
// first. "1.21.9+" also covers the year-numbered releases (26.x): from 1.21.9 the game
// reads min_format/max_format, so those packs say "this version and every later one".
export const VERSIONS = [
  ["1.21.9+ (and 26.x)", 69, { open: true }],
  ["1.21.7 – 1.21.8", 64], ["1.21.6", 63], ["1.21.5", 55], ["1.21.4", 46], ["1.21.2 – 1.21.3", 42],
  ["1.21 – 1.21.1", 34], ["1.20.5 – 1.20.6", 32], ["1.20.3 – 1.20.4", 22], ["1.20.2", 18], ["1.20 – 1.20.1", 15],
  ["1.19.4", 13], ["1.19.3", 12], ["1.19 – 1.19.2", 9], ["1.18", 8], ["1.17", 7], ["1.16.2 – 1.16.5", 6],
  ["1.15 – 1.16.1", 5], ["1.13 – 1.14", 4], ["1.11 – 1.12", 3], ["1.9 – 1.10", 2], ["1.6 – 1.8", 1],
];
// Old spellings the API and saved settings may still send, mapped to their row.
const ALIASES = { "1.21.8": "1.21.7 – 1.21.8", "1.21.7": "1.21.7 – 1.21.8", "1.21.3": "1.21.2 – 1.21.3", "1.21.2": "1.21.2 – 1.21.3",
  "1.21.1": "1.21 – 1.21.1", "1.21": "1.21 – 1.21.1", "1.20.6": "1.20.5 – 1.20.6", "1.20.4": "1.20.3 – 1.20.4", "1.20.1": "1.20 – 1.20.1" };
const BY_LABEL = new Map(VERSIONS.map(([label, format, opts]) => [label, { format, ...opts }]));
export const PACK_FORMATS = Object.fromEntries(VERSIONS.map(([l, f]) => [l, f]));
const versionOf = v => BY_LABEL.get(ALIASES[v] ?? v);

// Before 1.13 (format 4) texture folders were plural and some files had other names;
// some items didn't exist yet in the oldest versions.
const LEGACY_NAMES = {
  oak_planks: "planks_oak", birch_planks: "planks_birch", spruce_planks: "planks_spruce", bricks: "brick", stone_bricks: "stonebrick",
  mossy_cobblestone: "cobblestone_mossy", oak_log: "log_oak", white_wool: "wool_colored_white", red_wool: "wool_colored_red",
  blue_wool: "wool_colored_blue", black_wool: "wool_colored_black", terracotta: "hardened_clay", quartz_block_side: "quartz_block_side",
  golden_apple: "apple_golden", wooden_sword: "wood_sword", golden_sword: "gold_sword", golden_carrot: "carrot_golden",
  totem_of_undying: "totem", lapis_lazuli: "dye_powder_blue", experience_bottle: "experience_bottle", map: "map_empty",
  water_bucket: "bucket_water", bucket: "bucket_empty", clock: "clock", compass: "compass", furnace_front: "furnace_front_off",
  slime_ball: "slimeball", snowball: "snowball", quartz: "quartz", melon_side: "melon_side", pumpkin_side: "pumpkin_side",
};
// The pack_format each texture first appeared in (or got its modern file name).
const ADDED_IN = { "item/netherite_sword": 5, "item/totem_of_undying": 3, "block/amethyst_block": 7 };
const pathFor = (target, format) => {
  const [kind, name] = target.split("/");
  if (format >= 4) return `assets/minecraft/textures/${target}.png`;
  return `assets/minecraft/textures/${kind}s/${LEGACY_NAMES[name] ?? name}.png`;
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Accepts "data:image/png;base64,..." and returns the PNG bytes if it's a 16x16 PNG.
export function decodeTexture(dataUrl) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) throw new Error("Each texture must be a PNG image.");
  const png = Buffer.from(m[1], "base64");
  if (png.length > 20_000) throw new Error("A texture is too large.");
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE) || png.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("A texture isn't a valid PNG.");
  }
  if (png.readUInt32BE(16) !== 16 || png.readUInt32BE(20) !== 16) throw new Error("Textures must be 16 by 16 pixels.");
  return png;
}

export function texturePackFiles({ name, description, gameVersion, textures }) {
  if (!Array.isArray(textures) || !textures.length) throw new Error("Add at least one texture to the pack.");
  if (textures.length > 40) throw new Error("A pack can hold up to 40 textures.");
  const version = versionOf(gameVersion);
  if (!version) throw new Error("Pick a Minecraft version.");
  const { format } = version;

  const files = {};
  for (const t of textures) {
    if (!VALID.has(t?.target)) throw new Error("One of the textures replaces something Texture Forge doesn't support.");
    if ((ADDED_IN[t.target] ?? 0) > format) throw new Error(`${t.target.split("/")[1].replaceAll("_", " ")} isn't in Minecraft ${gameVersion}. Remove it or pick a newer version.`);
    files[pathFor(t.target, format)] = decodeTexture(t.png);
  }
  const title = String(name || "My Texture Pack").slice(0, 60);
  const pack = { pack_format: format, description: String(description || `${title}, made with ForgeCenter`).slice(0, 200) };
  // 1.21.9 and later read min_format/max_format; a high max keeps it working on later releases.
  if (version.open) Object.assign(pack, { min_format: format, max_format: 999 });
  files["pack.mcmeta"] = JSON.stringify({ pack }, null, 2);
  files["pack.png"] = files[pathFor(textures[0].target, format)];
  files["README.txt"] = `${title}\n\nMade with ForgeCenter Texture Forge for Minecraft ${gameVersion}.\n` +
    `Install: put this zip in .minecraft/resourcepacks, then turn it on in Options > Resource Packs.\n`;
  return files;
}
