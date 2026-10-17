// Small helpers for replying to interactions.
import { MessageFlags } from "discord.js";

/** A reply only the member who used the command can see. Mentions inside never ping anyone. */
export function ephemeral(content, extra = {}) {
  return { ...(content == null ? {} : { content }), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }, ...extra };
}

/** Cuts text to Discord's message length limit. */
export function truncate(text, max = 2000) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Shows an error to the member no matter what state the interaction is in.
 * Note: this bot never uses deferUpdate(), so "deferred but not replied" always means deferReply().
 */
export async function sendError(interaction, message) {
  const content = truncate(`❌ ${message}`);
  if (interaction.deferred && !interaction.replied) {
    return interaction.editReply({ content, embeds: [], components: [], files: [], allowedMentions: { parse: [] } });
  }
  if (interaction.replied) return interaction.followUp(ephemeral(content));
  return interaction.reply(ephemeral(content));
}
