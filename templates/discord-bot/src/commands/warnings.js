// /warnings list|remove|clear
import { EmbedBuilder, InteractionContextType, PermissionFlagsBits as P, SlashCommandBuilder, time, userMention } from "discord.js";
import { UserError } from "../lib/errors.js";
import { ephemeral } from "../lib/respond.js";
import { clearWarnings, countWarnings, listWarnings, removeWarning } from "../lib/warnings.js";
import { COLORS, sendLog } from "../features/logging.js";

const data = new SlashCommandBuilder()
  .setName("warnings")
  .setDescription("View or remove warnings")
  .setDefaultMemberPermissions(P.ModerateMembers)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s.setName("list").setDescription("Show a member's warnings")
      .addUserOption((o) => o.setName("user").setDescription("Whose warnings").setRequired(true)))
  .addSubcommand((s) =>
    s.setName("remove").setDescription("Delete one warning by its number")
      .addIntegerOption((o) => o.setName("number").setDescription("Warning number (shown in /warnings list)").setRequired(true).setMinValue(1)))
  .addSubcommand((s) =>
    s.setName("clear").setDescription("Delete all of a member's warnings")
      .addUserOption((o) => o.setName("user").setDescription("Whose warnings").setRequired(true)));

async function execute(interaction, ctx) {
  const { guildId } = interaction;
  const sub = interaction.options.getSubcommand();

  if (sub === "list") {
    const user = interaction.options.getUser("user", true);
    const total = countWarnings(ctx.db, guildId, user.id);
    const rows = listWarnings(ctx.db, guildId, user.id, 10);
    const lines = rows.map(
      (w) => `**#${w.id}** • ${time(new Date(w.createdAt), "d")} by ${userMention(w.moderatorId)}\n${w.reason}`,
    );
    const embed = new EmbedBuilder()
      .setColor(COLORS.warn)
      .setTitle(`Warnings for ${user.tag}`)
      .setDescription(lines.length ? lines.join("\n\n").slice(0, 4096) : "No warnings. 🎉")
      .setFooter({ text: total > rows.length ? `Showing the newest ${rows.length} of ${total}` : `Total: ${total}` });
    return interaction.reply(ephemeral(null, { embeds: [embed] }));
  }

  if (sub === "remove") {
    const id = interaction.options.getInteger("number", true);
    const removed = removeWarning(ctx.db, guildId, id);
    if (!removed) throw new UserError(`There is no warning #${id} in this server.`);
    await sendLog(interaction.guild, ctx.db, {
      content: `🗑️ ${interaction.user} removed warning #${id} from ${userMention(removed.userId)}.`,
    });
    return interaction.reply(ephemeral(`✅ Removed warning #${id} from ${userMention(removed.userId)}.`));
  }

  if (sub === "clear") {
    const user = interaction.options.getUser("user", true);
    const count = clearWarnings(ctx.db, guildId, user.id);
    if (count) {
      await sendLog(interaction.guild, ctx.db, {
        content: `🗑️ ${interaction.user} cleared ${count} warning(s) from ${user}.`,
      });
    }
    return interaction.reply(ephemeral(`✅ Cleared ${count} warning${count === 1 ? "" : "s"} from ${user}.`));
  }
}

export default { category: "Moderation (staff)", data, execute };
