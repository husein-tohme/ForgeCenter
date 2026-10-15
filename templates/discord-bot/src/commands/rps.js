// /rps: rock, paper, scissors against the bot.
import { InteractionContextType, SlashCommandBuilder } from "discord.js";
import { pick, RPS_CHOICES, rpsOutcome } from "../lib/games.js";

const RESULTS = { win: "You win! 🎉", lose: "I win! 😎", draw: "It's a draw! 🤝" };

const data = new SlashCommandBuilder()
  .setName("rps")
  .setDescription("Play rock, paper, scissors against me")
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) =>
    o.setName("choice").setDescription("Your move").setRequired(true).addChoices(
      { name: "🪨 Rock", value: "rock" },
      { name: "📄 Paper", value: "paper" },
      { name: "✂️ Scissors", value: "scissors" },
    ));

async function execute(interaction) {
  const player = interaction.options.getString("choice", true);
  const bot = pick(Object.keys(RPS_CHOICES));
  const outcome = rpsOutcome(player, bot);
  await interaction.reply(
    `You picked ${RPS_CHOICES[player].emoji} **${player}**, I picked ${RPS_CHOICES[bot].emoji} **${bot}**. ${RESULTS[outcome]}`,
  );
}

export default { category: "Games & coins", data, execute };
