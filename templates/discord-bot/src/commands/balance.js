// /balance: how many coins you (or someone else) have.
import { InteractionContextType, SlashCommandBuilder } from "discord.js";
import { getBalance, getRank } from "../lib/economy.js";

const data = new SlashCommandBuilder()
  .setName("balance")
  .setDescription("Check your coins")
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) => o.setName("user").setDescription("Check someone else's coins"));

async function execute(interaction, ctx) {
  const user = interaction.options.getUser("user") ?? interaction.user;
  const balance = getBalance(ctx.db, interaction.guildId, user.id);
  const rank = getRank(ctx.db, interaction.guildId, user.id);
  const who = user.id === interaction.user.id ? "You have" : `${user} has`;
  await interaction.reply({
    content: `💰 ${who} **${balance.toLocaleString("en-US")}** coins${rank ? ` (rank #${rank})` : ""}.` +
      (balance === 0 ? " Use `/daily` or `/trivia` to earn some!" : ""),
    allowedMentions: { parse: [] },
  });
}

export default { category: "Games & coins", data, execute };
