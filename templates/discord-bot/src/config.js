// Reads settings from environment variables (and the .env file next to package.json).
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The template folder (one level above src/). Relative paths are resolved from here,
// so the bot behaves the same no matter which folder pm2/systemd starts it from.
export const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));

const DEFAULT_SUBREDDITS = ["wholesomememes", "memes", "MinecraftMemes"];

function positiveInt(value, fallback) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Builds the config object from an env-like object. Pure, so it is easy to test.
 * `require` lists variables that must be present (e.g. ["DISCORD_TOKEN"]).
 */
export function buildConfig(env, { require = [] } = {}) {
  const missing = require.filter((key) => !env[key]?.trim());
  if (missing.length) {
    throw new Error(
      `Missing ${missing.join(", ")}. Copy .env.example to .env and fill it in (see README.md).`,
    );
  }

  const dbPath = env.DATABASE_PATH?.trim() || "data/bot.db";
  const subreddits = (env.MEME_SUBREDDITS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_]{2,21}$/.test(s));

  return {
    token: env.DISCORD_TOKEN?.trim(),
    clientId: env.CLIENT_ID?.trim() || null,
    guildId: env.GUILD_ID?.trim() || null,
    databasePath: dbPath === ":memory:" || isAbsolute(dbPath) ? dbPath : resolve(ROOT_DIR, dbPath),
    dailyCoins: positiveInt(env.DAILY_COINS, 100),
    triviaReward: positiveInt(env.TRIVIA_REWARD, 25),
    memeSubreddits: subreddits.length ? subreddits : DEFAULT_SUBREDDITS,
  };
}

/** Loads .env (if present) into process.env, then builds the config. */
export function loadConfig(options) {
  const envFile = resolve(ROOT_DIR, ".env");
  // Values already set in the real environment win over the .env file.
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  return buildConfig(process.env, options);
}
