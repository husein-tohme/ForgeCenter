import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { inflateRawSync } from "node:zlib";
import { api, db, signIn, download, url } from "./helpers.js";
import { robloxFiles, luaString, validate, TEMPLATES, EXTRAS } from "../src/robloxgen.js";
import { setModel } from "../src/ai.js";

const require = createRequire(import.meta.url);
const luaparse = require("luaparse");

// Roblox Forge is a plain generator: it must never reach Claude or spend AI allowance.
let modelCalls = 0;
setModel(() => { modelCalls++; throw new Error("Roblox Forge shouldn't call the model"); });
after(() => setModel(null));

// pseudo-latin1 keeps string values as raw bytes, the way Lua sees them.
const parse = code => luaparse.parse(code, { luaVersion: "5.1", encodingMode: "pseudo-latin1" });
const bytes = s => Buffer.from(s, "utf8").toString("latin1");

const BASE = { name: "Lava Run", currency: "Coins", gamePassId: "123456789" };
const subsets = list => list.reduce((all, x) => all.concat(all.map(s => [...s, x])), [[]]);

// Every node in a luaparse tree, depth first.
function* walk(node) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string") yield node;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const v of value) yield* walk(v);
    else if (value && typeof value === "object") yield* walk(value);
  }
}

// The value assigned to Config.<key> in Config.lua.
function configValue(ast, key) {
  const assign = ast.body.find(s => s.type === "AssignmentStatement" && s.variables[0].type === "MemberExpression"
    && s.variables[0].base.name === "Config" && s.variables[0].identifier.name === key);
  assert.ok(assign, `Config.${key} is set`);
  return assign.init[0];
}

// Reads a zip (stored or deflated entries) into { path: text }.
function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  assert.ok(eocd >= 0, "zip has an end record");
  const files = {};
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < buf.readUInt16LE(eocd + 10); i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    files[name] = (method === 8 ? inflateRawSync(raw) : raw).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

test("every template, with every mix of extras, generates Lua that parses", () => {
  let checked = 0;
  for (const template of Object.keys(TEMPLATES)) {
    for (const extras of subsets(Object.keys(EXTRAS))) {
      const { files } = robloxFiles({ ...BASE, template, extras });
      const lua = Object.entries(files).filter(([path]) => path.endsWith(".lua"));
      assert.ok(lua.length >= 6, `${template} has its scripts`);
      for (const [path, code] of lua) {
        // Non-ASCII text only ever reaches Lua as \ddd escapes.
        assert.match(code, /^[\x09\x0a\x20-\x7e]*$/, `${template} ${path} is plain ASCII`);
        assert.doesNotThrow(() => parse(code), `${template} [${extras}] ${path} parses as Lua 5.1`);
        // Luau-only syntax that Lua 5.1 tools (and older Studio builds) reject.
        assert.doesNotMatch(code, /[+\-*/]=|`|\bcontinue\b|\blocal\s+\w+\s*:\s*\w/, `${path} avoids Luau-only syntax`);
        checked++;
      }
      // Extras add their scripts only when picked.
      assert.equal("src/server/DailyReward.server.lua" in files, extras.includes("daily"));
      assert.equal("src/server/Leaderboard.server.lua" in files, extras.includes("leaderboard"));
      assert.equal("src/server/VipPerk.server.lua" in files, extras.includes("vip"));
      const config = parse(files["src/shared/Config.lua"]);
      for (const [extra, key] of [["daily", "DailyReward"], ["leaderboard", "Leaderboard"], ["vip", "Vip"]]) {
        const enabled = configValue(config, key).fields.find(f => f.key.name === "Enabled").value;
        assert.equal(enabled.value, extras.includes(extra), `${key}.Enabled matches the checkbox`);
      }
    }
  }
  assert.ok(checked > 200);
});

test("default.project.json is valid Rojo JSON and every $path exists", () => {
  for (const template of Object.keys(TEMPLATES)) {
    for (const extras of [[], Object.keys(EXTRAS)]) {
      const { files } = robloxFiles({ ...BASE, template, extras });
      const project = JSON.parse(files["default.project.json"]);
      assert.equal(project.name, "lava-run");
      const { tree } = project;
      assert.equal(tree.$className, "DataModel");
      assert.equal(tree.ReplicatedStorage.Shared.$path, "src/shared");
      assert.equal(tree.ServerScriptService.Server.$path, "src/server");
      assert.equal(tree.StarterPlayer.StarterPlayerScripts.Client.$path, "src/client");
      assert.equal(tree.Workspace.ForgeMap.$className, "Folder");
      assert.equal("Leaderboard" in tree.Workspace, extras.includes("leaderboard"));
      if (extras.includes("leaderboard")) {
        const board = tree.Workspace.Leaderboard;
        assert.equal(board.$className, "Part");
        assert.deepEqual(board.$properties.CFrame.CFrame.position, [-24, 7, 20]);
      }

      const paths = [];
      for (const node of (function* nodes(n) { yield n; for (const [k, v] of Object.entries(n)) if (!k.startsWith("$")) yield* nodes(v); })(tree)) {
        if (node.$path) paths.push(node.$path);
      }
      assert.equal(paths.length, 3);
      for (const p of paths) assert.ok(p in files || Object.keys(files).some(f => f.startsWith(p + "/")), `${p} exists`);

      // Rojo turns *.server.lua into Scripts, *.client.lua into LocalScripts, the rest into modules.
      for (const path of Object.keys(files)) {
        if (path.startsWith("src/client/")) assert.match(path, /^src\/client\/\w+\.client\.lua$/);
        if (path.startsWith("src/shared/")) assert.match(path, /^src\/shared\/\w+\.lua$/);
        if (path.startsWith("src/server/")) assert.match(path, /^src\/server\/(\w+\.server|DataService)\.lua$/);
      }
    }
  }
});

test("each template has the game pieces it promises", () => {
  const files = t => robloxFiles({ ...BASE, template: t, extras: Object.keys(EXTRAS) }).files;
  const obby = files("obby"), tycoon = files("tycoon"), sim = files("simulator"), rounds = files("minigame");

  // Every template: leaderstats with the currency, DataStore saving with retries and a cache.
  for (const f of [obby, tycoon, sim, rounds]) {
    const data = f["src/server/DataService.lua"], main = f["src/server/Main.server.lua"];
    assert.match(data, /GetDataStore\(Config\.DataStoreName\)/);
    assert.match(data, /pcall\(fn\)/);
    assert.match(data, /for attempt = 1, MAX_TRIES do/);
    assert.match(data, /local sessions = \{\}/);
    assert.match(main, /leaderstats/);
    assert.match(main, /addStat\(leaderstats, Config\.Currency/);
    assert.match(main, /Players\.PlayerRemoving:Connect/);
    assert.match(main, /game:BindToClose/);
    // Shutdown waits for every save in flight, including ones PlayerRemoving started.
    assert.match(data, /savesInFlight = savesInFlight \+ 1[\s\S]*SetAsync[\s\S]*savesInFlight = savesInFlight - 1/);
    assert.match(main, /BindToClose\(function\(\)[\s\S]*while DataService\.SavesInFlight\(\) > 0/);
    assert.match(f["src/shared/Config.lua"], /Config\.Currency = "Coins"/);
    assert.match(f["README.md"], /rojo serve/);
    assert.match(f["README.md"], /Enable Studio Access to API Services/);
    assert.match(f["README.md"], /Rokit|Aftman/);
    assert.match(f["README.md"], /Publish to Roblox/);
  }
  assert.match(obby["src/server/Main.server.lua"], /addStat\(leaderstats, "Stage"/);
  assert.match(obby["src/server/Obby.server.lua"], /KillPart/);
  assert.match(obby["src/server/Obby.server.lua"], /CharacterAdded/);
  assert.match(obby["src/server/Obby.server.lua"], /stage == profile\.Stage \+ 1/);
  assert.match(tycoon["src/server/Tycoon.server.lua"], /ClaimPad/);
  assert.match(tycoon["src/server/Tycoon.server.lua"], /collector\.Touched/);
  assert.match(tycoon["src/server/Tycoon.server.lua"], /DataService\.Spend\(player, Config\.DropperPrices\[index\]\)/);
  assert.match(sim["src/server/Simulator.server.lua"], /Instance\.new\("RemoteEvent"\)/);
  assert.match(sim["src/server/Simulator.server.lua"], /now - last < Config\.ClickCooldown/);
  assert.match(sim["src/server/DataService.lua"], /multiplier = multiplier \+ profile\.Rebirths/);
  assert.match(sim["src/client/Clicker.client.lua"], /click:FireServer\(\)/);
  assert.match(rounds["src/server/Minigame.server.lua"], /Next round in/);
  assert.match(rounds["src/server/Minigame.server.lua"], /teleport\(character, ARENA/);
  assert.match(rounds["src/server/Minigame.server.lua"], /DataService\.AddCurrency\(player, Config\.WinReward/);
  // Extras.
  assert.match(obby["src/server/DailyReward.server.lua"], /Config\.DailyReward\.Cooldown - \(now - profile\.LastDaily\)/);
  assert.match(obby["src/shared/Config.lua"], /Cooldown = 86400/);
  assert.match(obby["src/server/Leaderboard.server.lua"], /GetOrderedDataStore/);
  assert.match(obby["src/server/Leaderboard.server.lua"], /Instance\.new\("SurfaceGui"\)/);
  assert.match(obby["src/server/VipPerk.server.lua"], /pcall\(function\(\)\s+return MarketplaceService:UserOwnsGamePassAsync/);
  assert.match(obby["src/shared/Config.lua"], /GamePassId = 123456789,/);
});

test("names someone types become exact Lua string literals", () => {
  const attempts = [
    'Quote " in the middle',
    "Back\\slash \\\" and \\n",
    "]] .. os.exit() --[[",
    '"); game:Destroy() --',
    "Line\nbreak\r\nand\ttab",
    "Null\u0000byte and bell\u0007",
    "Emoji ✨ and accents é",
    "\\",
    "[==[ long ]==]",
  ];
  const plainStatements = parse(robloxFiles({ ...BASE, template: "obby" }).files["src/shared/Config.lua"]).body.length;
  for (const name of attempts) {
    const { files, options } = robloxFiles({ ...BASE, template: "obby", name });
    assert.equal(options.name, validate({ name }).name);
    assert.doesNotMatch(options.name, /[\u0000-\u001f]/, "control characters become spaces");
    const ast = parse(files["src/shared/Config.lua"]);
    const literal = configValue(ast, "GameName");
    assert.equal(literal.type, "StringLiteral");
    assert.equal(literal.value, bytes(options.name), `${JSON.stringify(name)} round-trips`);
    // Nothing broke out: same statements as a plain name, and no function calls at all.
    assert.equal(ast.body.length, plainStatements);
    assert.equal([...walk(ast)].filter(n => n.type === "CallExpression" || n.type === "StringCallExpression").length, 0);
    // The DataStore name only ever uses the slug.
    assert.match(configValue(ast, "DataStoreName").value, /^ForgeData_v1_[a-z0-9-]*$/);
    assert.ok(configValue(ast, "DataStoreName").value.length + "_Top".length <= 50, "fits Roblox's DataStore name limit");
  }

  // luaString itself handles raw control characters, newlines and ]] too.
  for (const raw of ["a\nb", "\r\t\u0000\u001f\u007f", "]]", "\\\"'", "x\u00001", "😀", ""]) {
    const literal = parse(`return ${luaString(raw)}`).body[0].arguments[0];
    assert.equal(literal.value, bytes(raw));
    assert.doesNotMatch(luaString(raw), /[\n\r\u0000]/);
  }
});

test("options are validated", () => {
  const bad = [
    [{ ...BASE, name: "" }, /name/],
    [{ ...BASE, name: "   " }, /name/],
    [{ ...BASE, name: "x".repeat(51) }, /50 characters/],
    [{ ...BASE, name: 42 }, /name/],
    [{ ...BASE, name: ["a"] }, /name/],
    [{ ...BASE, currency: 'Gold"' }, /letters, numbers and spaces/],
    [{ ...BASE, currency: "Gold]]" }, /letters, numbers and spaces/],
    [{ ...BASE, currency: "x".repeat(21) }, /up to 20/],
    [{ ...BASE, currency: "" }, /currency/],
    [{ ...BASE, currency: "Stage" }, /already used/],
    [{ ...BASE, currency: "rebirths" }, /already used/],
    [{ ...BASE, template: "battle-royale" }, /template/],
    [{ ...BASE, template: ["obby"] }, /template/],
    [{ ...BASE, extras: ["daily", "admin"] }, /extras/],
    [{ ...BASE, extras: "daily" }, /list/],
    [{ ...BASE, stages: 2 }, /Stages must be a whole number from 3 to 50/],
    [{ ...BASE, stages: "51" }, /Stages/],
    [{ ...BASE, stages: 3.5 }, /whole number/],
    [{ ...BASE, stages: "ten" }, /Stages/],
    [{ ...BASE, stages: "1e1" }, /Stages/],
    [{ ...BASE, stages: true }, /Stages/],
    [{ ...BASE, clickCooldown: 0.01 }, /Seconds between clicks/],
    [{ ...BASE, startingCurrency: -1 }, /Starting currency/],
    [{ ...BASE, extras: ["vip"], gamePassId: "" }, /digits only/],
    [{ ...BASE, extras: ["vip"], gamePassId: "12a" }, /digits only/],
    [{ ...BASE, extras: ["vip"], gamePassId: "-5" }, /digits only/],
    [{ ...BASE, extras: ["vip"], gamePassId: "1e5" }, /digits only/],
    [{ ...BASE, extras: ["vip"], gamePassId: "0" }, /digits only/],
    [{ ...BASE, extras: ["vip"], gamePassId: "1".repeat(16) }, /digits only/],
    [{ ...BASE, extras: ["vip"], gamePassId: "1); os.exit(" }, /digits only/],
  ];
  for (const [input, message] of bad) assert.throws(() => robloxFiles(input), message, JSON.stringify(input));

  // Limits themselves are fine, and numbers may arrive as strings from the form.
  const { options } = robloxFiles({ ...BASE, template: "simulator", stages: "50", clickCooldown: "0.1", extras: ["vip"], gamePassId: " 0042 " });
  assert.equal(options.numbers.stages, 50);
  assert.equal(options.numbers.clickCooldown, 0.1);
  // Number fields can send a decimal without a leading zero.
  assert.equal(robloxFiles({ ...BASE, template: "simulator", clickCooldown: ".5" }).options.numbers.clickCooldown, 0.5);
  assert.throws(() => robloxFiles({ ...BASE, clickCooldown: "." }), /Seconds between clicks/);
  assert.equal(options.gamePassId, 42);
  assert.match(robloxFiles({ ...BASE, template: "simulator", clickCooldown: 0.1 }).files["src/shared/Config.lua"], /Config\.ClickCooldown = 0\.1\n/);
  // Without the VIP extra, the game pass id is ignored rather than checked.
  assert.equal(robloxFiles({ ...BASE, gamePassId: "nope" }).options.gamePassId, 0);
  // Defaults when nothing but a name is sent.
  const defaults = robloxFiles({ name: "Tiny" }).options;
  assert.equal(defaults.template, "obby");
  assert.equal(defaults.currency, "Coins");
});

test("options and preview over the API", async () => {
  const options = await api("/api/roblox/options");
  assert.equal(options.status, 200);
  assert.deepEqual(options.body.templates.map(t => t.id), ["obby", "tycoon", "simulator", "minigame"]);
  assert.deepEqual(options.body.extras.map(x => x.id), ["daily", "leaderboard", "vip"]);
  assert.equal(options.body.limits.name, 50);
  assert.ok(options.body.numbers.every(n => typeof n.min === "number" && n.min <= n.default && n.default <= n.max));

  const preview = await api("/api/roblox/preview", { method: "POST", body: { ...BASE, template: "tycoon", extras: ["leaderboard"] } });
  assert.equal(preview.status, 200);
  const { files, text, main, slug } = preview.body;
  assert.equal(main, "src/server/Tycoon.server.lua");
  assert.equal(slug, "lava-run");
  assert.ok(files.some(f => f.path === "src/server/Leaderboard.server.lua" && f.lines > 10 && f.bytes > 100));
  assert.deepEqual(Object.keys(text).sort(), ["default.project.json", "src/server/Tycoon.server.lua", "src/shared/Config.lua"]);
  assert.equal(text["src/shared/Config.lua"], robloxFiles({ ...BASE, template: "tycoon", extras: ["leaderboard"] }).files["src/shared/Config.lua"]);

  // The visitor can open any generated file, and nothing else.
  const readme = await api("/api/roblox/preview", { method: "POST", body: { ...BASE, open: "README.md" } });
  assert.match(readme.body.text["README.md"], /^# Lava Run/);
  for (const open of ["../../package.json", "/etc/passwd", "src/server", { path: "README.md" }]) {
    const r = await api("/api/roblox/preview", { method: "POST", body: { ...BASE, open } });
    assert.equal(r.status, 200);
    assert.equal(Object.keys(r.body.text).length, 3);
  }

  for (const body of [{ ...BASE, name: "" }, { ...BASE, currency: "C'oins" }, { ...BASE, stages: 999 }, { ...BASE, extras: ["vip"], gamePassId: "abc" }]) {
    const r = await api("/api/roblox/preview", { method: "POST", body });
    assert.equal(r.status, 400);
    assert.ok(r.body.error.length > 10);
  }
  // Not JSON at all.
  const notJson = await api("/api/roblox/preview", { method: "POST", body: "name=x", headers: { "Content-Type": "text/plain" } });
  assert.equal(notJson.status, 415);
});

test("the zip download matches the generator and is saved for signed-in people", async () => {
  const body = { ...BASE, name: 'Lava "Run" ]] 2', template: "simulator", extras: ["daily", "vip"] };
  const out = await download("/api/roblox/zip", { body });
  assert.equal(out.status, 200);
  assert.equal(out.type, "application/zip");
  assert.equal(out.disposition, 'attachment; filename="lava-run-2.zip"');
  const zipped = unzip(out.buf);
  assert.deepEqual(zipped, robloxFiles(body).files);
  // Signed out: nothing saved.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mods WHERE kind = 'roblox'").get().n, 0);

  const sam = signIn("sam@example.com", "rbx-sam");
  const ada = signIn("ada@example.com", "rbx-ada", { age: "adult" });
  const saved = await download("/api/roblox/zip", { body, cookie: sam.cookie });
  assert.equal(saved.status, 200);
  const failed = await download("/api/roblox/zip", { body: { ...body, currency: "No!" }, cookie: sam.cookie });
  assert.equal(failed.status, 400);

  const mine = await api("/api/creations", { cookie: sam.cookie });
  assert.deepEqual(mine.body.creations.map(c => [c.kind, c.name]), [["roblox", 'Lava "Run" ]] 2']]);
  // Other people don't see it, and adults can use the tool the same way.
  assert.deepEqual((await api("/api/creations", { cookie: ada.cookie })).body.creations, []);
  assert.equal((await download("/api/roblox/zip", { body: BASE, cookie: ada.cookie })).status, 200);
  assert.deepEqual((await api("/api/creations", { cookie: ada.cookie })).body.creations.map(c => c.name), ["Lava Run"]);
  // A brand-new account that hasn't answered the birthday question can still download.
  const fresh = signIn("new@example.com", "rbx-new", { age: null });
  assert.equal((await download("/api/roblox/zip", { body: BASE, cookie: fresh.cookie })).status, 200);
});

test("downloads are protected from cross-site requests and spam", async () => {
  const cross = await fetch(url("/api/roblox/zip"), {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify(BASE),
  });
  assert.equal(cross.status, 403);

  const spammer = signIn("spam@example.com", "rbx-spam");
  for (let i = 0; i < 20; i++) assert.equal((await download("/api/roblox/zip", { body: BASE, cookie: spammer.cookie })).status, 200);
  const limited = await download("/api/roblox/zip", { body: BASE, cookie: spammer.cookie });
  assert.equal(limited.status, 429);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mods WHERE user_id = ? AND kind = 'roblox'").get(spammer.user.id).n, 20);
  assert.equal(modelCalls, 0);
});
