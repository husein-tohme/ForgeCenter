// /serverinfo: a quick overview of this server.
import { ChannelType, EmbedBuilder, InteractionContextType, SlashCommandBuilder, time, userMention } from "discord.js";
import { COLORS } from "../features/logging.js";

const data = new SlashCommandBuilder()
  .setName("serverinfo")
  .setDescription("Show information about this server")
  .setContexts(InteractionContextType.Guild);

async function execute(interaction) {
  const { guild } = interaction;
  const channels = guild.channels.cache;
  const count = (...types) => channels.filter((c) => types.includes(c.type)).size;
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(guild.name)
    .setThumbnail(guild.iconURL({ size: 256 }))
    .addFields(
      { name: "Owner", value: userMention(guild.ownerId), inline: true },
      { name: "Members", value: guild.memberCount.toLocaleString("en-US"), inline: true },
      { name: "Created", value: time(guild.createdAt, "D"), inline: true },
      { name: "Text channels", value: String(count(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum)), inline: true },
      { name: "Voice channels", value: String(count(ChannelType.GuildVoice, ChannelType.GuildStageVoice)), inline: true },
      { name: "Roles", value: String(guild.roles.cache.size - 1), inline: true },
      { name: "Boosts", value: `${guild.premiumSubscriptionCount ?? 0} (level ${guild.premiumTier})`, inline: true },
    )
    .setFooter({ text: `Server ID: ${guild.id}` });
  if (guild.description) embed.setDescription(guild.description);
  await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

export default { category: "Utility", data, execute };
