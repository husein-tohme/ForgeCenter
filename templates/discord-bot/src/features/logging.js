// Posting to the server's log channel (set with /setup logs).
import { EmbedBuilder, userMention } from "discord.js";
import { getSettings } from "../lib/settings.js";

export const COLORS = {
  info: 0x5865f2,
  success: 0x22c55e,
  warn: 0xfacc15,
  timeout: 0xf97316,
  kick: 0xef4444,
  ban: 0xb91c1c,
  purge: 0x3b82f6,
};

/**
 * Sends a message to the log channel.
 * Returns true when sent, false when it failed, and null when no log channel is set.
 */
export async function sendLog(guild, db, payload) {
  const { logChannelId } = getSettings(db, guild.id);
  if (!logChannelId) return null;
  try {
    const channel = guild.channels.cache.get(logChannelId) ?? (await guild.channels.fetch(logChannelId));
    if (!channel?.isTextBased()) return false;
    await channel.send({ allowedMentions: { parse: [] }, ...payload });
    return true;
  } catch (error) {
    console.warn(`[log] Could not post to the log channel in "${guild.name}": ${error.message}`);
    return false;
  }
}

/** A standard embed for moderation actions. */
export function moderationEmbed({ action, title, target, moderator, reason, fields = [] }) {
  return new EmbedBuilder()
    .setColor(COLORS[action] ?? COLORS.info)
    .setTitle(title)
    .addFields(
      { name: "Member", value: `${userMention(target.id)} (${target.tag})`, inline: true },
      { name: "Moderator", value: userMention(moderator.id), inline: true },
      ...fields,
      { name: "Reason", value: reason },
    )
    .setFooter({ text: `User ID: ${target.id}` })
    .setTimestamp();
}
