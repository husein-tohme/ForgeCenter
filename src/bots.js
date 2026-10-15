// Bot runner entry point: `npm run bots`. Run it next to the website (same database).
import { existsSync } from "node:fs";
import { createBotRunner } from "./botrunner.js";
import { secretsEnabled } from "./secrets.js";

if (!secretsEnabled()) {
  console.error("SECRET_KEY must be set (at least 32 characters) so bot tokens can be decrypted.");
  process.exit(1);
}
if (!existsSync("templates/discord-bot/node_modules")) {
  console.error("Install the bot's packages first: npm run setup:bots");
  process.exit(1);
}
if (existsSync("templates/discord-bot/.env")) {
  console.warn("Warning: templates/discord-bot/.env exists. Its settings would apply to every customer's bot, so remove it on the hosting server.");
}

const runner = createBotRunner();
let ticking = false;
const tick = async () => {
  if (ticking) return;
  ticking = true;
  try { await runner.tick(); } catch (e) { console.error("Bot runner", e); } finally { ticking = false; }
};
tick();
setInterval(tick, 10_000);
console.log("Bot runner started.");

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, async () => {
    console.log("Stopping bots…");
    await runner.stopAll();
    process.exit(0);
  });
}
