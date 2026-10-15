// /coinflip: heads or tails.
import { InteractionContextType, SlashCommandBuilder } from "discord.js";
import { coinFlip } from "../lib/games.js";

const data = new SlashCommandBuilder()
  .setName("coinflip")
  .setDescription("Flip a coin")
  .setContexts(InteractionContextType.Guild);

async function execute(interaction) {
  await interaction.reply(`🪙 The coin landed on **${coinFlip()}**!`);
}

export default { category: "Fun", data, execute };
