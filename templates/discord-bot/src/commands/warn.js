// /warn: give a member a warning. Warnings are saved and can be viewed with /warnings.
import { InteractionContextType, PermissionFlagsBits as P, SlashCommandBuilder } from "discord.js";
import { UserError } from "../lib/errors.js";
import { addWarning } from "../lib/warnings.js";
import { logModeration, reasonOf, requireCanModerate, requireMember, tryDm } from "../features/moderation.js";

const data = new SlashCommandBuilder()
  .setName("warn")
  .setDescription("Warn a member")
  .setDefaultMemberPermissions(P.ModerateMembers)
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) => o.setName("user").setDescription("Who to warn").setRequired(true))
  .addStringOption((o) => o.setName("reason").setDescription("Why").setRequired(true).setMaxLength(500));

async function execute(interaction, ctx) {
  const target = requireMember(interaction);
  if (target.user.bot) throw new UserError("Bots can't be warned.");
  requireCanModerate(interaction, target, { checkBot: false });
  const reason = reasonOf(interaction);

  const { id, total } = addWarning(ctx.db, {
    guildId: interaction.guildId,
    userId: target.id,
    moderatorId: interaction.user.id,
    reason,
  });
  const dmed = await tryDm(target.user, `⚠️ You were warned in **${interaction.guild.name}**: ${reason}`);
  await logModeration(interaction, ctx, {
    action: "warn",
    title: "⚠️ Member warned",
    target: target.user,
    reason,
    fields: [{ name: "Warnings", value: `${total} (this is #${id})`, inline: true }],
  });
  await interaction.reply({
    content: `⚠️ Warned ${target} (they now have ${total} warning${total === 1 ? "" : "s"}). Reason: ${reason}` +
      (dmed ? "" : "\n*(I couldn't DM them.)*"),
    allowedMentions: { parse: [] },
  });
}

export default { category: "Moderation (staff)", data, execute };
