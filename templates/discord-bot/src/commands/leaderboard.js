// /leaderboard: the richest members of the server.
import { EmbedBuilder, InteractionContextType, SlashCommandBuilder, userMention } from "discord.js";
import { getRank, leaderboard } from "../lib/economy.js";
import { COLORS } from "../features/logging.js";

const MEDALS = ["🥇", "🥈", "🥉"];

const data = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("See who has the most coins")
  .setContexts(InteractionContextType.Guild);

async function execute(interaction, ctx) {
  const top = leaderboard(ctx.db, interaction.guildId, 10);
  const lines = top.map(
    (row, i) => `${MEDALS[i] ?? `**${i + 1}.**`} ${userMention(row.userId)} • ${row.balance.toLocaleString("en-US")} coins`,
  );
  const rank = getRank(ctx.db, interaction.guildId, interaction.user.id);
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(`🏆 ${interaction.guild.name} leaderboard`)
    .setDescription(lines.length ? lines.join("\n") : "Nobody has any coins yet. Be the first with `/daily`!")
    .setFooter({ text: rank ? `Your rank: #${rank}` : "Earn coins with /daily and /trivia" });
  await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

export default { category: "Games & coins", data, execute };
