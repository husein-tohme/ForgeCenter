// Forge Guide: ForgeCenter's own Minecraft helper. It answers from a hand-written
// knowledge base by matching the words in the question, so it's free, instant and works
// with no outside AI. When an AI key is set, the mentor uses Claude instead; this is the
// fallback and the "always on" answer for common questions.

// Each entry: words that point to it, a title and a short plain-language answer.
// Answers are for Java Edition unless they say otherwise.
export const GUIDE = [
  { keys: "nether portal obsidian flint steel", title: "Making a Nether portal",
    answer: "Build a frame of obsidian at least 4 wide and 5 tall (the corners can be left empty, so 10 obsidian is enough). Light the inside with flint and steel or a fire charge. You need a diamond or netherite pickaxe to mine obsidian, or you can make it by pouring water onto still lava." },
  { keys: "piston door 2x2 redstone sticky", title: "A 2×2 piston door",
    answer: "Use 4 sticky pistons, 2 on each side, facing the doorway, each holding a block. Power all four at once from a lever or pressure plates; a line of redstone dust under the floor or behind the walls connects them. Sticky pistons pull the blocks back when the power turns off, which opens the door. Build it once in creative first, it's much easier to see the wiring." },
  { keys: "redstone clock repeater loop pulse", title: "A simple redstone clock",
    answer: "The easiest clock is a ring of 4 repeaters and redstone dust in a loop. Give it one short pulse (a button) and the signal keeps going round. Click the repeaters to slow it down. On newer versions an observer facing into another observer also makes a very fast clock." },
  { keys: "comparator subtract compare signal strength", title: "What a comparator does",
    answer: "A comparator outputs a signal based on what's behind it: it can read how full a chest or furnace is, compare two signals, or subtract one from another (right-click to switch to subtract mode, the front torch lights up). It's how item sorters and hidden doors with item locks work." },
  { keys: "enchant enchanting table bookshelves lapis level", title: "Getting the best enchantments",
    answer: "Put 15 bookshelves around an enchanting table, with one block of air between them and the table. You need lapis lazuli and 30 levels for the best (level 30) enchantments. Combine enchanted books on an anvil to add more, and use a grindstone to remove ones you don't want." },
  { keys: "mending villager librarian trade book", title: "Finding Mending",
    answer: "Mending comes from librarian villagers. Place a lectern next to an unemployed villager to make it a librarian, check its trades, and if Mending isn't there, break and replace the lectern (before you trade with it) until it shows up. Mending can also be found in chests and while fishing." },
  { keys: "potion brew brewing stand blaze nether wart awkward", title: "Brewing potions",
    answer: "You need a brewing stand (made with a blaze rod), blaze powder to fuel it, and water bottles. Add nether wart first to make Awkward Potions, then the effect ingredient: sugar for Swiftness, glistering melon for Healing, golden carrot for Night Vision, magma cream for Fire Resistance. Redstone makes it last longer, glowstone makes it stronger, gunpowder makes it a splash potion." },
  { keys: "iron farm golem villager", title: "How iron farms work",
    answer: "Iron golems spawn near villagers that have beds and get scared by a zombie. A basic iron farm keeps 3 villagers with beds next to a trapped zombie they can see, and a spawning platform where golems appear, fall into lava or onto a drop, and leave iron. Search for a design made for your exact version, because spawn rules change between updates." },
  { keys: "mob farm spawner dark light level grinder", title: "Mob farms",
    answer: "Hostile mobs spawn in darkness (light level 0 on newer versions). A mob farm is a dark platform high in the sky, far from other caves, with water pushing mobs into a drop that leaves them on 1 hit. Light up nearby caves so mobs spawn on your platform instead." },
  { keys: "elytra end city ship dragon fly", title: "Getting an elytra",
    answer: "Beat the Ender Dragon, then throw an ender pearl into the small gateway portal that appears. Look for End Cities with a floating End Ship; the elytra hangs in an item frame inside the ship. Fly with firework rockets and repair it with phantom membranes or Mending." },
  { keys: "beacon pyramid wither nether star", title: "Building a beacon",
    answer: "Craft a beacon from a nether star (from the Wither), 3 obsidian and 5 glass. Put it on a pyramid of iron, gold, emerald, diamond or netherite blocks: 9 blocks for level 1, up to 164 blocks for the full 4-level pyramid. Then pick a power and pay with an ingot, emerald or diamond." },
  { keys: "give command item cheat", title: "The /give command",
    answer: "/give @p diamond_sword 1 gives the nearest player a diamond sword. Swap the item name and amount as you like. You need cheats on (Open to LAN, Allow Cheats) or operator permission on a server. Since 1.20.5 extra data uses components, like /give @p diamond_sword[enchantments={sharpness:5}]." },
  { keys: "gamemode creative survival spectator adventure command", title: "Changing game mode",
    answer: "/gamemode creative, /gamemode survival, /gamemode spectator or /gamemode adventure. Add a player name to change someone else's. You need cheats or operator permission." },
  { keys: "teleport tp coordinates command", title: "Teleporting",
    answer: "/tp @s 100 64 -200 moves you to those coordinates. /tp PlayerName moves you to a player. Press F3 to see your own coordinates. ~ means 'where I am now', so /tp @s ~ ~10 ~ moves you 10 blocks up." },
  { keys: "fill command blocks area clear", title: "Filling an area with /fill",
    answer: "/fill x1 y1 z1 x2 y2 z2 stone fills the box between two corners with stone. Use air to clear an area, and add hollow, outline or replace for other shapes. It works on up to 32,768 blocks at once." },
  { keys: "keep inventory gamerule death items command", title: "Keeping your items when you die",
    answer: "Run /gamerule keepInventory true. It needs cheats or operator permission and applies to the whole world." },
  { keys: "diamond diamonds find level y mine strip", title: "Finding diamonds",
    answer: "Since 1.18, diamonds are most common deep down, around Y -58 to -59. Strip mine at that height with tunnels 2 or 3 blocks apart, and look in caves for exposed ore. A Fortune III pickaxe gives more diamonds per ore." },
  { keys: "netherite ancient debris upgrade smithing template", title: "Getting netherite",
    answer: "Mine ancient debris in the Nether, most common around Y 15. Beds explode in the Nether, which is a fast (and dangerous) way to clear rock. Smelt 4 debris into scraps, combine 4 scraps and 4 gold into an ingot, then upgrade diamond gear at a smithing table with a netherite upgrade template (found in bastions)." },
  { keys: "install fabric mod mods loader folder", title: "Installing Fabric mods",
    answer: "Download the Fabric installer from fabricmc.net and run it for your Minecraft version. Put mod .jar files (and Fabric API) in the .minecraft/mods folder, then pick the Fabric profile in the launcher. Easier: use the Modrinth App or Prism Launcher, or import a pack made with Modpack Forge." },
  { keys: "forge neoforge install mod", title: "Installing Forge or NeoForge mods",
    answer: "Download the installer for your Minecraft version from neoforged.net (NeoForge) or files.minecraftforge.net (Forge), run it, choose Install client, then put mods in .minecraft/mods. Mods only work with the loader they were made for, so check each mod's page." },
  { keys: "resource pack texture install folder", title: "Installing a resource pack",
    answer: "Put the .zip in .minecraft/resourcepacks (Options, Resource Packs, Open Pack Folder takes you there), then move it to the Selected side. Don't unzip it. Make your own with Texture Forge." },
  { keys: "shader shaders iris optifine", title: "Installing shaders",
    answer: "On modern versions install the Iris mod with Sodium (both on Modrinth, Fabric), then put shader packs like Complementary or BSL in .minecraft/shaderpacks. Pick them in Options, Video Settings, Shader Packs." },
  { keys: "server setup host paper java run start", title: "Running your own server",
    answer: "Download Paper from papermc.io, put it in an empty folder, and start it with java -Xmx2G -jar paper.jar nogui. Accept the EULA in eula.txt, start it again, and connect to localhost. Friends need your public IP and port 25565 forwarded on your router, or use a hosted server so you don't have to." },
  { keys: "plugin plugins paper spigot install", title: "Adding plugins to a server",
    answer: "Plugins are .jar files for Paper or Spigot servers (not Fabric). Put them in the server's plugins folder and restart. EssentialsX, LuckPerms and WorldEdit are good first plugins. You can make a simple one with Plugin Forge." },
  { keys: "op operator permission admin server", title: "Giving someone operator",
    answer: "In the server console type op PlayerName (or /op PlayerName in game if you're already an operator). For finer control over who can do what, use the LuckPerms plugin." },
  { keys: "whitelist private server friends", title: "Making a server private",
    answer: "Run /whitelist on, then /whitelist add PlayerName for each friend. Only people on the list can join." },
  { keys: "java learn code coding mod start begin", title: "Learning to code mods",
    answer: "Minecraft Java mods are written in Java. Learn the basics first: variables, if statements, loops, classes and methods. Then install IntelliJ IDEA (free Community edition), download a mod project from Mod Forge, and change one thing at a time, like an item's name or what it does when used." },
  { keys: "javascript html css website learn code", title: "Learning to make websites",
    answer: "Websites use three languages: HTML for what's on the page, CSS for how it looks, and JavaScript for what it does. Start with one HTML file, add a style tag for CSS, then a script tag for JavaScript, and open it in your browser. Change one thing, refresh, repeat." },
  { keys: "python learn code beginner", title: "Starting with Python",
    answer: "Python is a friendly first language. Install it from python.org, open a file called hello.py with print(\"Hello!\") in it, and run it with python hello.py. Then learn variables, if, for loops and functions with small projects like a number guessing game." },
  { keys: "discord bot token setup", title: "Setting up a Discord bot",
    answer: "Create an application at discord.com/developers, add a Bot, copy its token (keep it secret, never share it), and invite it with the OAuth2 URL generator using the bot scope. A ForgeCenter Discord bot comes with tickets, moderation and mini-games ready to switch on." },
  { keys: "orbs orb currency buy spend", title: "What orbs are",
    answer: "Orbs are ForgeCenter's currency: 1 orb is 1 cent. You can spend them on anything with a one-time price and on extra AI messages. They never expire and can't be cashed out or sent to other people." },
  { keys: "lag fps slow performance sodium", title: "Fixing lag",
    answer: "For more FPS on Fabric, install Sodium, Lithium and FerriteCore. Lower render distance and simulation distance, and turn off fancy graphics and clouds. Give the game 4 to 6 GB of RAM in the launcher, not more, unless you run a big modpack." },
  { keys: "villager breeding trading hall", title: "Breeding villagers",
    answer: "Villagers breed when there are free beds and they have enough food: give them bread, carrots, potatoes or beetroot. Each new villager needs its own bed. Trap them in a trading hall with workstations to choose their jobs." },
  { keys: "crafting recipe craft table", title: "Crafting basics",
    answer: "Open your inventory for a 2×2 crafting grid, or use a crafting table (4 planks) for 3×3. The recipe book (green book icon) shows everything you can make with what you have. Turn on 'show all' to see recipes you've unlocked but can't make yet." },
];

const STOP = new Set("a an the to of in on for and or is it i my me how do does can what why when where with you your make get be are this that from at by as".split(" "));
const words = text => String(text).toLowerCase().replace(/[^a-z0-9×+ ]+/g, " ").split(/\s+/).filter(w => w && !STOP.has(w));
// A few everyday spellings people type.
const ALIAS = { tp: "teleport", gm: "gamemode", ench: "enchant", enchantment: "enchant", enchantments: "enchant", pots: "potion", potions: "potion",
  mods: "mod", plugins: "plugin", textures: "texture", portal: "portal", redstone: "redstone", doors: "door", farms: "farm", diamonds: "diamond", shaders: "shader" };
const norm = w => ALIAS[w] ?? w.replace(/(ing|es|s)$/, m => (w.length > 4 ? "" : m));

const INDEX = GUIDE.map(e => ({ ...e, words: new Set(words(`${e.keys} ${e.title}`).map(norm)) }));
// Rare words count for more than common ones ("teleport" beats "command").
const DF = new Map();
for (const e of INDEX) for (const w of e.words) DF.set(w, (DF.get(w) ?? 0) + 1);
const weight = w => 1 / (DF.get(w) ?? 1);

// The best entries for a question, best first. Empty when nothing really matches.
export function lookup(question, limit = 3) {
  const q = [...new Set(words(question).map(norm))];
  if (!q.length) return [];
  return INDEX.map(e => ({ e, score: q.reduce((n, w) => n + (e.words.has(w) ? weight(w) : 0), 0) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => ({ title: x.e.title, answer: x.e.answer, score: x.score }));
}

// A chat reply in the mentor's voice, built from the knowledge base.
export function guideReply(question) {
  const found = lookup(question);
  if (!found.length) {
    return "I'm Forge Guide, ForgeCenter's built-in helper. I don't have an answer for that one yet. Try asking about redstone, commands, enchanting, potions, farms, installing mods, resource packs, servers, plugins or learning to code.";
  }
  const [best, ...more] = found;
  const also = more.filter(m => m.score >= best.score * 0.6).map(m => m.title);
  return `${best.title}\n\n${best.answer}${also.length ? `\n\nRelated: ${also.join(", ")}. Ask me about any of them.` : ""}`;
}
