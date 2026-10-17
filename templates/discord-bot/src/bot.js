// Creates the Discord client, wires up events and starts the bot.
import { ActivityType, Client, Events, GatewayCloseCodes, GatewayIntentBits } from "discord.js";
import { buildRegistry, commands } from "./commands/index.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { handleMemberJoin, handleMemberUpdate } from "./features/welcome.js";
import { createInteractionHandler } from "./interactions.js";
import { inviteUrl } from "./lib/permissions.js";

// Only what we use. GuildMembers is a "privileged" intent: it must be switched on in the
// Developer Portal (Bot page > Server Members Intent) or Discord refuses the connection.
// Ticket transcripts read messages over the REST API, which needs "Message Content Intent"
// switched on in the portal too, but it doesn't have to be requested here.
export const INTENTS = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers];

const HELP = {
  [GatewayCloseCodes.DisallowedIntents]:
    "Discord refused the connection because a privileged intent is off.\n" +
    "Fix: Developer Portal > your app > Bot > turn on SERVER MEMBERS INTENT and MESSAGE CONTENT INTENT, save, then restart.",
  [GatewayCloseCodes.AuthenticationFailed]:
    "Discord rejected the token. Fix: Developer Portal > Bot > Reset Token, put the new token in .env (DISCORD_TOKEN), restart.",
};

/** Runs an event handler and logs errors instead of letting them crash the bot. */
function safe(name, handler) {
  return async (...args) => {
    try {
      await handler(...args);
    } catch (error) {
      console.error(`[error] ${name} failed:`, error);
    }
  };
}

export function createBot({ config, db }) {
  const client = new Client({
    intents: INTENTS,
    allowedMentions: { parse: ["users"], repliedUser: false }, // never @everyone or role pings by accident
    presence: { activities: [{ name: "/help", type: ActivityType.Listening }] },
  });
  const { byName, components } = buildRegistry(commands);
  const ctx = { db, config, commands };

  client.once(Events.ClientReady, (ready) => {
    console.log(`[ready] Logged in as ${ready.user.tag}, in ${ready.guilds.cache.size} server(s).`);
    console.log(`[ready] Invite link: ${inviteUrl(ready.application.id)}`);
  });
  client.on(Events.InteractionCreate, createInteractionHandler({ commands: byName, components, ctx }));
  client.on(Events.GuildMemberAdd, safe("welcome", (member) => handleMemberJoin(member, ctx)));
  client.on(Events.GuildMemberUpdate, safe("auto-role", (before, after) => handleMemberUpdate(before, after, ctx)));

  client.on(Events.Error, (error) => console.error("[discord] Client error:", error));
  client.on(Events.Warn, (message) => console.warn("[discord]", message));
  client.on(Events.ShardError, (error) => console.error("[discord] Connection error:", error.message));
  client.on(Events.ShardDisconnect, ({ code }) => {
    // discord.js only emits this for problems it can't recover from on its own.
    console.error(`[discord] Disconnected for good (code ${code}). ${HELP[code] ?? "Restarting may help."}`);
    process.exit(1);
  });
  return client;
}

export async function start() {
  let config;
  try {
    config = loadConfig({ require: ["DISCORD_TOKEN"] });
  } catch (error) {
    console.error(`[config] ${error.message}`);
    process.exit(1);
  }

  let db;
  try {
    db = openDatabase(config.databasePath);
  } catch (error) {
    console.error(`[db] Could not open ${config.databasePath}: ${error.message}`);
    console.error("[db] Check that the folder exists and this user is allowed to write to it (see DATABASE_PATH in .env).");
    process.exit(1);
  }
  console.log(`[db] Using ${config.databasePath}`);
  const client = createBot({ config, db });

  // Last line of defence: log anything unexpected and keep running.
  process.on("unhandledRejection", (reason) => console.error("[error] Unhandled promise rejection:", reason));
  process.on("uncaughtException", (error) => console.error("[error] Uncaught exception:", error));

  const shutdown = async (signal) => {
    console.log(`[shutdown] ${signal} received, logging out.`);
    await client.destroy().catch(() => {});
    db.close();
    process.exit(0);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  try {
    await client.login(config.token);
  } catch (error) {
    console.error(`[discord] Could not log in: ${error.message}`);
    if (error.code === "TokenInvalid") console.error(HELP[GatewayCloseCodes.AuthenticationFailed]);
    if (/intent/i.test(error.message)) console.error(HELP[GatewayCloseCodes.DisallowedIntents]);
    db.close();
    process.exit(1);
  }
}
