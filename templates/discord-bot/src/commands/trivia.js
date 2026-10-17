// /trivia: answer a question within 20 seconds to win coins.
import { InteractionContextType, SlashCommandBuilder } from "discord.js";
import { answerTrivia, startTrivia } from "../features/trivia.js";

const data = new SlashCommandBuilder()
  .setName("trivia")
  .setDescription("Answer a trivia question to win coins")
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) =>
    o.setName("category").setDescription("What kind of question").addChoices(
      { name: "Anything", value: "any" },
      { name: "Minecraft", value: "minecraft" },
      { name: "General knowledge", value: "general" },
    ));

async function execute(interaction, ctx) {
  await startTrivia(interaction, ctx, interaction.options.getString("category") ?? "any");
}

export default { category: "Games & coins", data, execute, components: { trivia: answerTrivia } };
