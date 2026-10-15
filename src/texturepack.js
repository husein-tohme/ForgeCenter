// Texture Forge: turns 16x16 drawings into a Minecraft Java resource pack.

// Vanilla textures people can replace. Only untinted, single-image textures so
// what you draw is exactly what you see in game.
export const TEXTURE_TARGETS = {
  item: [
    "diamond_sword", "diamond_pickaxe", "diamond_axe", "diamond_shovel", "iron_sword", "netherite_sword",
    "wooden_sword", "apple", "golden_apple", "bread", "cookie", "diamond", "emerald", "gold_ingot",
    "iron_ingot", "stick", "ender_pearl", "totem_of_undying", "nether_star", "experience_bottle",
  ],
  block: [
    "dirt", "stone", "cobblestone", "oak_planks", "bricks", "sand", "gravel", "obsidian", "glass",
    "diamond_ore", "diamond_block", "emerald_block", "gold_block", "iron_block", "netherrack",
    "end_stone", "tnt_side", "crafting_table_front", "bookshelf",
  ],
};
const VALID = new Set(Object.entries(TEXTURE_TARGETS).flatMap(([kind, names]) => names.map(n => `${kind}/${n}`)));

// pack_format per Minecraft Java version.
export const PACK_FORMATS = {
  "1.21.8": 64, "1.21.7": 64, "1.21.6": 63, "1.21.5": 55, "1.21.4": 46,
  "1.21.3": 42, "1.21.2": 42, "1.21.1": 34, "1.21": 34, "1.20.6": 32, "1.20.4": 22, "1.20.1": 15,
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
  const format = PACK_FORMATS[gameVersion];
  if (!format) throw new Error("Pick a Minecraft version.");

  const files = {};
  for (const t of textures) {
    if (!VALID.has(t?.target)) throw new Error("One of the textures replaces something Texture Forge doesn't support.");
    files[`assets/minecraft/textures/${t.target}.png`] = decodeTexture(t.png);
  }
  const title = String(name || "My Texture Pack").slice(0, 60);
  files["pack.mcmeta"] = JSON.stringify({
    pack: { pack_format: format, description: String(description || `${title}, made with ForgeCenter`).slice(0, 200) },
  }, null, 2);
  files["pack.png"] = files[`assets/minecraft/textures/${textures[0].target}.png`];
  files["README.txt"] = `${title}\n\nMade with ForgeCenter Texture Forge for Minecraft ${gameVersion}.\n` +
    `Install: put this zip in .minecraft/resourcepacks, then turn it on in Options > Resource Packs.\n`;
  return files;
}
