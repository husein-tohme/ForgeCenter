// Registers the slash commands with Discord. Run it once after setup and again whenever commands change.
//
//   npm run register              -> the server in GUILD_ID (instant), or global if GUILD_ID is empty
//   npm run register -- --global  -> every server the bot is in (can take up to an hour to show up)
//   npm run register -- --clear-guild -> remove the server-only copies (use after switching to global,
//                                        otherwise each command shows up twice in that server)
import { REST, Routes } from "discord.js";
import { commandsJson } from "./commands/index.js";
import { loadConfig } from "./config.js";

const args = new Set(process.argv.slice(2));

let config;
try {
  config = loadConfig({ require: ["DISCORD_TOKEN", "CLIENT_ID"] });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const rest = new REST().setToken(config.token);
const body = commandsJson();

try {
  if (args.has("--clear-guild")) {
    if (!config.guildId) throw new Error("GUILD_ID is empty, so there are no server-only commands to clear.");
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: [] });
    console.log(`Removed the server-only commands from server ${config.guildId}.`);
  } else if (args.has("--global") || !config.guildId) {
    await rest.put(Routes.applicationCommands(config.clientId), { body });
    console.log(`Registered ${body.length} commands globally. They can take up to an hour to appear.`);
  } else {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
    console.log(`Registered ${body.length} commands in server ${config.guildId}. They should appear right away.`);
  }
} catch (error) {
  console.error(`Registering failed: ${error.message}`);
  if (error.status === 401) console.error("Check DISCORD_TOKEN in .env.");
  if (error.status === 403 || error.code === 50001) {
    console.error("Is the bot in that server, and was it invited with the applications.commands scope? See README.md.");
  }
  if (error.status === 404 || error.code === 10002) console.error("Check CLIENT_ID (Application ID) in .env.");
  process.exitCode = 1;
}
