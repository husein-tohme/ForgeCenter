// /meme: a random safe-for-work meme from https://meme-api.com
import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { fetchMeme } from "../lib/meme.js";
import { COLORS } from "../features/logging.js";

const data = new SlashCommandBuilder()
  .setName("meme")
  .setDescription("Get a random (safe for work) meme")
  .setContexts(InteractionContextType.Guild);

async function execute(interaction, ctx) {
  await interaction.deferReply();
  let meme = null;
  try {
    meme = await fetchMeme({ subreddits: ctx.config.memeSubreddits });
  } catch (error) {
    console.warn(`[meme] ${error.message}`);
  }
  if (!meme) {
    return interaction.editReply("😴 The meme machine is taking a nap. Try again in a minute!");
  }
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(meme.title)
    .setImage(meme.url)
    .setFooter({ text: `r/${meme.subreddit} • 👍 ${meme.ups.toLocaleString("en-US")}` });
  if (meme.postLink) embed.setURL(meme.postLink);
  await interaction.editReply({ embeds: [embed] });
}

export default { category: "Fun", data, execute };
