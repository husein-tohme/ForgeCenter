import test from "node:test";
import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import { buildConfig } from "../src/config.js";

test("defaults are sensible", () => {
  const c = buildConfig({ DISCORD_TOKEN: "t" });
  assert.equal(c.token, "t");
  assert.equal(c.guildId, null);
  assert.ok(isAbsolute(c.databasePath) && c.databasePath.endsWith("bot.db"));
  assert.equal(c.dailyCoins, 100);
  assert.equal(c.triviaReward, 25);
  assert.ok(c.memeSubreddits.length > 0);
});

test("missing required values give a clear error", () => {
  assert.throws(() => buildConfig({ DISCORD_TOKEN: "  " }, { require: ["DISCORD_TOKEN", "CLIENT_ID"] }), /DISCORD_TOKEN, CLIENT_ID/);
});

test("optional values are read and cleaned up", () => {
  const c = buildConfig({
    DISCORD_TOKEN: "t", CLIENT_ID: " 1 ", GUILD_ID: "", DATABASE_PATH: ":memory:",
    DAILY_COINS: "250", TRIVIA_REWARD: "nope", MEME_SUBREDDITS: "memes, bad/sub ,aww",
  });
  assert.equal(c.clientId, "1");
  assert.equal(c.guildId, null);
  assert.equal(c.databasePath, ":memory:");
  assert.equal(c.dailyCoins, 250);
  assert.equal(c.triviaReward, 25, "invalid numbers fall back to the default");
  assert.deepEqual(c.memeSubreddits, ["memes", "aww"]);
});
