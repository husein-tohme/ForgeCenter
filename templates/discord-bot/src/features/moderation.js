// Shared checks for /warn, /timeout, /kick, /ban and /purge.
import { UserError } from "../lib/errors.js";
import { missingPermissions, moderationBlocker } from "../lib/permissions.js";
import { moderationEmbed, sendLog } from "./logging.js";

const position = (member) => member.roles.highest.position;

/** Throws a UserError if the bot is missing any of these permissions in this channel. */
export function requireBotPermissions(interaction, flags) {
  const missing = missingPermissions(interaction.appPermissions, flags);
  if (missing.length) {
    throw new UserError(
      `I need the **${missing.join("**, **")}** permission${missing.length > 1 ? "s" : ""} for that. ` +
        "Ask an admin to give it to my role.",
    );
  }
}

/** Throws a UserError if the person using the command may not act on `target` (a GuildMember). */
export function requireCanModerate(interaction, target, { checkBot = true } = {}) {
  const { guild, member } = interaction;
  const me = guild.members.me;
  const problem = moderationBlocker({
    actor: { id: member.id, position: position(member) },
    target: { id: target.id, position: position(target) },
    bot: { id: me.id, position: position(me) },
    ownerId: guild.ownerId,
    checkBot,
  });
  if (problem) throw new UserError(problem);
}

/** Gets the member from a required "user" option, or explains that they're not in the server. */
export function requireMember(interaction, option = "user") {
  const member = interaction.options.getMember(option);
  if (!member) throw new UserError("That user isn't in this server.");
  return member;
}

/** Tries to DM a member. Returns true if it worked (many people have DMs turned off). */
export async function tryDm(user, content) {
  try {
    await user.send({ content, allowedMentions: { parse: [] } });
    return true;
  } catch {
    return false;
  }
}

/** Posts a moderation action to the log channel. */
export function logModeration(interaction, ctx, { action, title, target, reason, fields }) {
  return sendLog(interaction.guild, ctx.db, {
    embeds: [moderationEmbed({ action, title, target, moderator: interaction.user, reason, fields })],
  });
}

export const reasonOf = (interaction) => interaction.options.getString("reason") ?? "No reason given";
