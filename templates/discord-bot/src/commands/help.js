// /help: lists every command, grouped by category.
import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { helpSections } from "../lib/help.js";
import { ephemeral, truncate } from "../lib/respond.js";
import { COLORS } from "../features/logging.js";

const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("List all my commands")
  .setContexts(InteractionContextType.Guild);

async function execute(interaction, ctx) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle("📖 Commands")
    .setDescription("Admins: start with `/setup view` to see what's configured.")
    .addFields(
      helpSections(ctx.commands).map(({ category, lines }) => ({ name: category, value: truncate(lines.join("\n"), 1024) })),
    );
  await interaction.reply(ephemeral(null, { embeds: [embed] }));
}

export default { category: "Utility", data, execute };
