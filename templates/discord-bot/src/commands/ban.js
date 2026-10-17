// /ban: ban someone (they can't rejoin until unbanned in Server Settings > Bans).
import { InteractionContextType, PermissionFlagsBits as P, SlashCommandBuilder } from "discord.js";
import { UserError } from "../lib/errors.js";
import { logModeration, reasonOf, requireBotPermissions, requireCanModerate, tryDm } from "../features/moderation.js";

const DELETE_CHOICES = [
  { name: "Don't delete any", value: 0 },
  { name: "Last hour", value: 3600 },
  { name: "Last 24 hours", value: 86400 },
  { name: "Last 7 days", value: 604800 },
];

const data = new SlashCommandBuilder()
  .setName("ban")
  .setDescription("Ban someone from the server")
  .setDefaultMemberPermissions(P.BanMembers)
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) => o.setName("user").setDescription("Who to ban").setRequired(true))
  .addStringOption((o) => o.setName("reason").setDescription("Why").setMaxLength(500))
  .addIntegerOption((o) =>
    o.setName("delete_messages").setDescription("Also delete their recent messages").addChoices(...DELETE_CHOICES));

async function execute(interaction, ctx) {
  requireBotPermissions(interaction, [P.BanMembers]);
  const user = interaction.options.getUser("user", true);
  const member = interaction.options.getMember("user"); // null if they're not in the server
  if (member) {
    requireCanModerate(interaction, member);
    if (!member.bannable) throw new UserError("I can't ban this member.");
  } else if (user.id === interaction.user.id || user.id === interaction.client.user.id) {
    throw new UserError("Nice try. 🙂");
  }
  const reason = reasonOf(interaction);
  const deleteMessageSeconds = interaction.options.getInteger("delete_messages") ?? 0;

  const dmed = member
    ? await tryDm(user, `🔨 You were banned from **${interaction.guild.name}**. Reason: ${reason}`)
    : false;
  await interaction.guild.members.ban(user, { reason: `${reason} (by ${interaction.user.tag})`, deleteMessageSeconds });
  await logModeration(interaction, ctx, { action: "ban", title: "🔨 Member banned", target: user, reason });
  await interaction.reply({
    content: `🔨 Banned **${user.tag}**. Reason: ${reason}` + (member && !dmed ? "\n*(I couldn't DM them.)*" : ""),
    allowedMentions: { parse: [] },
  });
}

export default { category: "Moderation (staff)", data, execute };
