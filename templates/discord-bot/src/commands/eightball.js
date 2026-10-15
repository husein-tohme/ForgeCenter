// /8ball: ask the magic 8-ball a yes/no question.
import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { eightBall } from "../lib/games.js";
import { COLORS } from "../features/logging.js";

const data = new SlashCommandBuilder()
  .setName("8ball")
  .setDescription("Ask the magic 8-ball a yes/no question")
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) => o.setName("question").setDescription("Your question").setRequired(true).setMaxLength(200));

async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle("🎱 Magic 8-ball")
    .addFields(
      { name: "You asked", value: interaction.options.getString("question", true) },
      { name: "The 8-ball says", value: eightBall() },
    );
  await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

export default { category: "Fun", data, execute };
