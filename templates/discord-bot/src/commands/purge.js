// /purge: bulk-delete recent messages in this channel.
import { EmbedBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits as P, SlashCommandBuilder } from "discord.js";
import { UserError } from "../lib/errors.js";
import { COLORS, sendLog } from "../features/logging.js";
import { requireBotPermissions } from "../features/moderation.js";

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000; // Discord can't bulk-delete older messages

const data = new SlashCommandBuilder()
  .setName("purge")
  .setDescription("Delete recent messages in this channel")
  .setDefaultMemberPermissions(P.ManageMessages)
  .setContexts(InteractionContextType.Guild)
  .addIntegerOption((o) =>
    o.setName("amount").setDescription("How many messages (1-100)").setRequired(true).setMinValue(1).setMaxValue(100))
  .addUserOption((o) => o.setName("user").setDescription("Only delete messages from this person"));

async function execute(interaction, ctx) {
  requireBotPermissions(interaction, [P.ViewChannel, P.ReadMessageHistory, P.ManageMessages]);
  const { channel } = interaction;
  if (!channel?.isTextBased() || !("bulkDelete" in channel)) throw new UserError("I can't purge messages here.");
  const amount = interaction.options.getInteger("amount", true);
  const user = interaction.options.getUser("user");

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const recent = await channel.messages.fetch({ limit: 100 });
  const cutoff = Date.now() - FOURTEEN_DAYS_MS;
  const matching = [...recent.values()].filter((m) => !user || m.author.id === user.id).slice(0, amount);
  const deletable = matching.filter((m) => m.createdTimestamp > cutoff && !m.pinned);
  const deleted = deletable.length ? await channel.bulkDelete(deletable, true) : new Map();

  const skipped = matching.length - deleted.size;
  await sendLog(interaction.guild, ctx.db, {
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.purge)
        .setTitle("🧹 Messages purged")
        .addFields(
          { name: "Channel", value: `${channel}`, inline: true },
          { name: "Deleted", value: String(deleted.size), inline: true },
          { name: "Moderator", value: `${interaction.user}`, inline: true },
          ...(user ? [{ name: "Only from", value: `${user}`, inline: true }] : []),
        )
        .setTimestamp(),
    ],
  });
  await interaction.editReply(
    `🧹 Deleted ${deleted.size} message${deleted.size === 1 ? "" : "s"}.` +
      (skipped > 0 ? ` Skipped ${skipped} (pinned or older than 14 days, which Discord doesn't allow bulk-deleting).` : ""),
  );
}

export default { category: "Moderation (staff)", data, execute };
