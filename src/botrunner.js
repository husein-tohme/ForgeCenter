// Keeps every paid customer's Discord bot running: one child process per bot,
// started from templates/discord-bot with only that bot's own settings.
import { spawn as nodeSpawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { db, now as isoNow } from "./db.js";
import { decrypt } from "./secrets.js";

const BACKOFF_MS = [5_000, 30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];
const STABLE_MS = 10 * 60_000; // a bot that ran this long has its crash count reset
const RUNNING_AFTER_MS = 15_000;
const LOG_LINES = 40;

export function createBotRunner({
  spawn = nodeSpawn,
  templateDir = resolve("templates/discord-bot"),
  dataDir = resolve(process.env.BOT_DATA_DIR || "data/bots"),
  nodePath = process.execPath,
  clock = Date.now,
} = {}) {
  const bots = new Map(); // service id -> { child, startedAt, crashes, nextStart, busy, stopping, lines }
  mkdirSync(dataDir, { recursive: true });

  const save = (id, fields) => {
    const keys = Object.keys(fields);
    db.prepare(`UPDATE services SET ${keys.map(k => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .run(...keys.map(k => fields[k]), isoNow(), id);
  };

  // Only what the bot needs. The site's own secrets (Stripe, SECRET_KEY...) never reach it.
  const envFor = (s, token) => ({
    PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "production",
    DISCORD_TOKEN: token, CLIENT_ID: s.bot_app_id, GUILD_ID: "",
    DATABASE_PATH: join(dataDir, `bot-${s.id}.db`),
  });

  function run(args, env, bot) {
    const child = spawn(nodePath, ["--disable-warning=ExperimentalWarning", ...args], { cwd: templateDir, env, stdio: ["ignore", "pipe", "pipe"] });
    const capture = chunk => {
      for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) bot.lines.push(line.slice(0, 300));
      if (bot.lines.length > LOG_LINES) bot.lines.splice(0, bot.lines.length - LOG_LINES);
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    return child;
  }

  const exited = child => new Promise(r => child.once("exit", code => r(code)));

  function crashed(s, bot, reason) {
    bot.crashes = bot.startedAt && clock() - bot.startedAt > STABLE_MS ? 1 : bot.crashes + 1;
    bot.nextStart = clock() + BACKOFF_MS[Math.min(bot.crashes - 1, BACKOFF_MS.length - 1)];
    save(s.id, { bot_status: "crashed", last_error: reason, log_tail: bot.lines.join("\n") });
  }

  async function start(s) {
    const bot = bots.get(s.id);
    bot.busy = true;
    try {
      const env = envFor(s, decrypt(s.bot_token_enc));
      if (!s.commands_registered) {
        save(s.id, { bot_status: "starting" });
        const code = await exited(run(["src/register.js", "--global"], env, bot));
        if (code !== 0) return crashed(s, bot, "Registering slash commands failed.");
        save(s.id, { commands_registered: 1 });
      }
      const child = run(["src/index.js"], env, bot);
      Object.assign(bot, { child, startedAt: clock(), stopping: false });
      save(s.id, { bot_status: "starting", bot_started_at: bot.startedAt, last_error: null });
      child.once("exit", code => {
        bot.child = null;
        if (bot.stopping) { bot.nextStart = 0; return; }
        crashed(s, bot, `The bot stopped (exit code ${code}).`);
      });
    } catch (e) {
      crashed(s, bot, e.message);
    } finally { bot.busy = false; }
  }

  function stop(bot) {
    if (!bot.child) return;
    bot.stopping = true;
    bot.child.kill("SIGTERM");
  }

  async function tick() {
    const rows = db.prepare(`SELECT s.*, o.status AS order_status FROM services s JOIN orders o ON o.id = s.order_id
      WHERE s.kind = 'discord_bot'`).all();
    const wanted = new Set();
    for (const s of rows) {
      if (s.state !== "active" || !s.bot_token_enc || s.order_status === "canceled") continue;
      wanted.add(s.id);
      if (!bots.has(s.id)) bots.set(s.id, { child: null, startedAt: 0, crashes: 0, nextStart: 0, busy: false, stopping: false, lines: [] });
      const bot = bots.get(s.id);
      if (bot.busy) continue;
      if (s.restart_requested) {
        save(s.id, { restart_requested: 0 });
        bot.crashes = 0; bot.nextStart = 0;
        if (bot.child) { stop(bot); await exited(bot.child).catch(() => {}); }
      }
      if (!bot.child && bot.nextStart <= clock()) await start(s);
      else if (bot.child) {
        const fields = { log_tail: bot.lines.join("\n") };
        if (s.bot_status !== "running" && clock() - bot.startedAt >= RUNNING_AFTER_MS) fields.bot_status = "running";
        save(s.id, fields);
      }
    }
    for (const [id, bot] of bots) {
      if (wanted.has(id)) continue;
      stop(bot);
      bots.delete(id);
      save(id, { bot_status: "stopped" });
    }
  }

  async function stopAll() {
    const children = [...bots.values()].map(b => b.child).filter(Boolean);
    for (const bot of bots.values()) stop(bot);
    await Promise.all(children.map(c => exited(c)));
  }

  return { tick, stopAll, bots };
}
