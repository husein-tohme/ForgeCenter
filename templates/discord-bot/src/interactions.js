// Sends each slash command / button / menu to the right handler, and makes sure that
// one failing interaction never crashes the bot and always gets an answer.
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import { UserError } from "./lib/errors.js";
import { ephemeral, sendError } from "./lib/respond.js";

/** Friendly text for Discord errors a server admin can fix. */
function friendlyMessage(error) {
  if (error instanceof UserError) return error.message;
  if (error instanceof DiscordAPIError) {
    if (error.code === RESTJSONErrorCodes.MissingPermissions || error.code === RESTJSONErrorCodes.MissingAccess) {
      return "I'm missing a permission for that. Ask an admin to check my role's permissions (and that my role is high enough in the role list).";
    }
    if (error.code === RESTJSONErrorCodes.UnknownMember) return "That member isn't in this server any more.";
  }
  return "Something went wrong on my side. Please try again in a moment.";
}

function describe(interaction) {
  if (interaction.isChatInputCommand()) return `/${interaction.commandName}`;
  if ("customId" in interaction) return `component ${interaction.customId}`;
  return `interaction type ${interaction.type}`;
}

/**
 * commands: Map(name -> command module), components: Map(customId prefix -> handler).
 * A component's customId looks like "prefix:anything", e.g. "ticket:open".
 */
export function createInteractionHandler({ commands, components, ctx }) {
  return async function handleInteraction(interaction) {
    try {
      if (interaction.isAutocomplete()) return; // no command uses autocomplete

      if (!interaction.inCachedGuild()) {
        throw new UserError(
          interaction.guildId
            ? "I'm not fully added to this server. Ask an admin to invite me again with the invite link from the bot's owner."
            : "Please use me inside a server.",
        );
      }

      if (interaction.isChatInputCommand()) {
        const command = commands.get(interaction.commandName);
        if (!command) throw new UserError("That command no longer exists. Ask the bot owner to run `npm run register`.");
        await command.execute(interaction, ctx);
      } else if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
        const handler = components.get(interaction.customId.split(":")[0]);
        if (!handler) throw new UserError("This button is no longer active.");
        await handler(interaction, ctx);
      } else {
        return;
      }

      // Safety net: Discord shows "This interaction failed" if we never answer.
      if (!interaction.replied && !interaction.deferred) await interaction.reply(ephemeral("✅ Done."));
    } catch (error) {
      if (!(error instanceof UserError)) console.error(`[error] ${describe(interaction)} failed:`, error);
      await sendError(interaction, friendlyMessage(error)).catch((replyError) =>
        console.error(`[error] Could not tell the member about it: ${replyError.message}`),
      );
    }
  };
}
