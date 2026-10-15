// Imports every source file to catch syntax errors and broken imports.
// (index.js and register.js are skipped because importing them starts the bot / talks to Discord.)
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = new URL("../src/", import.meta.url).pathname;
const SKIP = new Set(["index.js", "register.js"]);

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(dir, entry.name)) : entry.name.endsWith(".js") ? [join(dir, entry.name)] : [],
  );
}

for (const file of listFiles(SRC)) {
  const name = relative(SRC, file);
  if (SKIP.has(name)) continue;
  test(`imports src/${name}`, async () => {
    const mod = await import(pathToFileURL(file));
    assert.ok(Object.keys(mod).length > 0, "module exports something");
  });
}

test("the bot client can be created without connecting", async () => {
  const { createBot, INTENTS } = await import("../src/bot.js");
  const { openDatabase } = await import("../src/db.js");
  const { buildConfig } = await import("../src/config.js");
  const db = openDatabase(":memory:");
  const client = createBot({ config: buildConfig({ DISCORD_TOKEN: "x" }), db });
  assert.equal(INTENTS.length, 2);
  assert.ok(client.listenerCount("interactionCreate") === 1);
  assert.ok(client.listenerCount("guildMemberAdd") === 1);
  await client.destroy();
  db.close();
});
