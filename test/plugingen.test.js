import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { api, download } from "./helpers.js";
import { pluginFiles } from "../src/plugingen.js";

const STUBS = fileURLToPath(new URL("./fixtures/paper-stubs", import.meta.url));
const hasJavac = spawnSync("javac", ["-version"]).status === 0;

const SAMPLE = {
  name: "Skyblock Helper", author: "Steve Crafter", description: 'Rules: be "nice" # no griefing', gameVersion: "1.21.1",
  commands: [{ name: "/discord", reply: "<aqua>Join us: discord.gg/abc" }, { name: "rules", reply: "Hi {player}: no griefing! ✨" }],
  welcome: "<green>Welcome, {player}!", announcements: "Vote daily!\n\n<gold>Shop: /warp shop", announceEvery: "15",
};

function compile(files) {
  const dir = mkdtempSync(join(tmpdir(), "plugin-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  const main = Object.keys(files).find(p => p.endsWith(".java"));
  execFileSync("javac", ["-d", join(dir, "out"), "-sourcepath", STUBS, join(dir, main)], { stdio: "pipe" });
}

test("plugin.yml and config.yml are valid YAML with the right content", () => {
  const files = pluginFiles(SAMPLE);
  const plugin = YAML.parse(files["src/main/resources/plugin.yml"]);
  assert.equal(plugin.name, "SkyblockHelper");
  assert.equal(plugin.main, "com.stevecrafter.skyblockhelper.SkyblockHelper");
  assert.equal(plugin["api-version"], "1.21");
  assert.equal(plugin.description, 'Rules: be "nice" # no griefing');
  assert.deepEqual(Object.keys(plugin.commands), ["discord", "rules", "skyblockhelperreload"]);
  assert.equal(plugin.permissions["skyblockhelper.reload"].default, "op");

  const config = YAML.parse(files["src/main/resources/config.yml"]);
  assert.equal(config["welcome-message"], "<green>Welcome, <player>!");
  assert.deepEqual(config.commands, { discord: "<aqua>Join us: discord.gg/abc", rules: "Hi <player>: no griefing! ✨" });
  assert.deepEqual(config.announcements, { "every-minutes": 15, messages: ["Vote daily!", "<gold>Shop: /warp shop"] });
  assert.match(files["build.gradle.kts"], /paper-api:1\.21\.1-R0\.1-SNAPSHOT/);
});

test("empty plugins still produce valid config", () => {
  const config = YAML.parse(pluginFiles({ name: "Tiny", author: "a", gameVersion: "1.20.4" })["src/main/resources/config.yml"]);
  assert.deepEqual(config.commands, {});
  assert.deepEqual(config.announcements.messages, []);
});

test("bad input gets a clear message", () => {
  const bad = [
    [{ ...SAMPLE, name: "!!!" }, /starts with a letter/],
    [{ ...SAMPLE, gameVersion: "1.8" }, /Minecraft version/],
    [{ ...SAMPLE, commands: [{ name: "has space", reply: "x" }] }, /isn't a valid command/],
    [{ ...SAMPLE, commands: [{ name: "a", reply: "x" }, { name: "A", reply: "y" }] }, /twice/],
    [{ ...SAMPLE, commands: [{ name: "skyblockhelperreload", reply: "x" }] }, /twice/],
    [{ ...SAMPLE, commands: [{ name: "spawn", reply: "" }] }, /Write what \/spawn should say/],
  ];
  for (const [input, message] of bad) assert.throws(() => pluginFiles(input), message);
});

test("generated Java compiles against the Paper API", { skip: !hasJavac && "javac isn't installed" }, () => {
  compile(pluginFiles(SAMPLE));
  // Names that clash with Java keywords or the classes the plugin uses.
  compile(pluginFiles({ name: "Player", author: "class", gameVersion: "1.21.8", commands: [{ name: "x", reply: "y" }] }));
  compile(pluginFiles({ name: "new", author: "2fast", gameVersion: "1.20.4" }));
});

test("Plugin Forge previews and downloads over the API", async () => {
  const preview = await api("/api/plugin/preview", { method: "POST", body: SAMPLE });
  assert.match(preview.body.files["plugin.yml"], /name: SkyblockHelper/);
  const bad = await api("/api/plugin/preview", { method: "POST", body: { ...SAMPLE, name: "" } });
  assert.equal(bad.status, 400);
  const zip = await download("/api/plugin/zip", { body: SAMPLE });
  assert.equal(zip.type, "application/zip");
  assert.ok(zip.buf.includes("src/main/resources/plugin.yml"));
  assert.ok(zip.buf.includes("SkyblockHelper.java"));
});
