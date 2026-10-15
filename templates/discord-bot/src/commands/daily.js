// /daily: free coins once a day, with a bonus for claiming several days in a row.
import { InteractionContextType, SlashCommandBuilder } from "discord.js";
import { claimDaily } from "../lib/economy.js";
import { formatDuration } from "../lib/duration.js";
import { ephemeral } from "../lib/respond.js";

const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Claim your daily coins")
  .setContexts(InteractionContextType.Guild);

async function execute(interaction, ctx) {
  const result = claimDaily(ctx.db, interaction.guildId, interaction.user.id, { base: ctx.config.dailyCoins });
  if (!result.ok) {
    return interaction.reply(ephemeral(`⏳ You already claimed today. Come back in **${formatDuration(result.retryInMs)}**.`));
  }
  const streak = result.streak > 1 ? ` 🔥 ${result.streak}-day streak (+${result.bonus} bonus)!` : "";
  await interaction.reply({
    content: `💰 ${interaction.user} claimed **${result.amount}** coins!${streak} Balance: **${result.balance.toLocaleString("en-US")}**`,
    allowedMentions: { parse: [] },
  });
}

export default { category: "Games & coins", data, execute };
