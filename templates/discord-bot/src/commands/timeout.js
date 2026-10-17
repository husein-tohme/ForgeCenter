// /timeout: stop a member from chatting for a while (Discord's built-in timeout).
import { InteractionContextType, PermissionFlagsBits as P, SlashCommandBuilder, time } from "discord.js";
import { UserError } from "../lib/errors.js";
import { formatDuration, MAX_TIMEOUT_MS, parseDuration } from "../lib/duration.js";
import {
  logModeration, reasonOf, requireBotPermissions, requireCanModerate, requireMember, tryDm,
} from "../features/moderation.js";

const data = new SlashCommandBuilder()
  .setName("timeout")
  .setDescription("Time out a member (or remove a timeout)")
  .setDefaultMemberPermissions(P.ModerateMembers)
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) => o.setName("user").setDescription("Who to time out").setRequired(true))
  .addStringOption((o) =>
    o.setName("duration").setDescription('How long, like 10m, 2h or 1d (max 28d). Type "off" to remove a timeout.').setRequired(true).setMaxLength(20))
  .addStringOption((o) => o.setName("reason").setDescription("Why").setMaxLength(500));

async function execute(interaction, ctx) {
  requireBotPermissions(interaction, [P.ModerateMembers]);
  const target = requireMember(interaction);
  requireCanModerate(interaction, target);
  if (target.permissions.has(P.Administrator)) throw new UserError("Discord doesn't allow timing out administrators.");
  if (!target.moderatable) throw new UserError("I can't time out this member.");
  const reason = reasonOf(interaction);
  const input = interaction.options.getString("duration", true).trim().toLowerCase();

  if (["off", "remove", "none", "0"].includes(input)) {
    if (!target.isCommunicationDisabled()) throw new UserError(`${target} isn't timed out.`);
    await target.timeout(null, `${reason} (by ${interaction.user.tag})`);
    await logModeration(interaction, ctx, { action: "info", title: "🔊 Timeout removed", target: target.user, reason });
    return interaction.reply({ content: `🔊 Removed the timeout for ${target}.`, allowedMentions: { parse: [] } });
  }

  const ms = parseDuration(input);
  if (!ms) throw new UserError(`I can't read "${input}". Try something like \`10m\`, \`2h\`, \`1d\` or \`1h30m\`.`);
  if (ms > MAX_TIMEOUT_MS) throw new UserError("Timeouts can be at most 28 days.");

  await target.timeout(ms, `${reason} (by ${interaction.user.tag})`);
  const until = new Date(Date.now() + ms);
  await tryDm(target.user, `⏳ You were timed out in **${interaction.guild.name}** for ${formatDuration(ms)}. Reason: ${reason}`);
  await logModeration(interaction, ctx, {
    action: "timeout",
    title: "⏳ Member timed out",
    target: target.user,
    reason,
    fields: [{ name: "Duration", value: `${formatDuration(ms)} (until ${time(until, "f")})`, inline: true }],
  });
  await interaction.reply({
    content: `⏳ Timed out ${target} for **${formatDuration(ms)}** (ends ${time(until, "R")}). Reason: ${reason}`,
    allowedMentions: { parse: [] },
  });
}

export default { category: "Moderation (staff)", data, execute };
