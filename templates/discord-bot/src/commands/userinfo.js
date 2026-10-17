// /userinfo: details about a member.
import { EmbedBuilder, InteractionContextType, SlashCommandBuilder, time } from "discord.js";
import { COLORS } from "../features/logging.js";

const data = new SlashCommandBuilder()
  .setName("userinfo")
  .setDescription("Show information about a member")
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) => o.setName("user").setDescription("Who (leave empty for yourself)"));

async function execute(interaction) {
  const user = interaction.options.getUser("user") ?? interaction.user;
  const member = interaction.options.getMember("user") ?? (user.id === interaction.user.id ? interaction.member : null);
  const embed = new EmbedBuilder()
    .setColor(member?.displayColor || 0x5865f2)
    .setTitle(member?.displayName ?? user.displayName)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: "Username", value: user.tag, inline: true },
      { name: "Bot?", value: user.bot ? "Yes" : "No", inline: true },
      { name: "Account created", value: time(user.createdAt, "D"), inline: true },
    )
    .setFooter({ text: `User ID: ${user.id}` });

  if (member) {
    const roles = member.roles.cache
      .filter((role) => role.id !== interaction.guildId)
      .sort((a, b) => b.position - a.position)
      .map((role) => `${role}`);
    // Fit as many role mentions as possible into one field (max 1024 characters).
    let shown = "";
    let count = 0;
    for (const role of roles) {
      if (shown.length + role.length + 20 > 1024) break;
      shown += `${role} `;
      count++;
    }
    if (count < roles.length) shown += `and ${roles.length - count} more`;
    embed.addFields(
      { name: "Joined server", value: member.joinedAt ? time(member.joinedAt, "D") : "Unknown", inline: true },
      { name: `Roles (${roles.length})`, value: shown.trim() || "None" },
    );
  } else {
    embed.setDescription("Not a member of this server.");
  }
  await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

export default { category: "Utility", data, execute };
