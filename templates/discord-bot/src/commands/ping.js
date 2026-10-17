// /ping: check that the bot is awake and how fast it answers.
import { InteractionContextType, SlashCommandBuilder } from "discord.js";

const data = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Check that I'm awake")
  .setContexts(InteractionContextType.Guild);

async function execute(interaction) {
  const response = await interaction.reply({ content: "🏓 Pinging…", withResponse: true });
  const roundTrip = response.resource.message.createdTimestamp - interaction.createdTimestamp;
  const gateway = interaction.client.ws.ping;
  await interaction.editReply(
    `🏓 Pong! Reply time: **${roundTrip} ms**. Connection: **${gateway >= 0 ? `${gateway} ms` : "measuring…"}**.`,
  );
}

export default { category: "Utility", data, execute };
