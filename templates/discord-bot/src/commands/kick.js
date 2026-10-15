// /kick: remove a member from the server (they can rejoin with an invite).
import { InteractionContextType, PermissionFlagsBits as P, SlashCommandBuilder } from "discord.js";
import { UserError } from "../lib/errors.js";
import {
  logModeration, reasonOf, requireBotPermissions, requireCanModerate, requireMember, tryDm,
} from "../features/moderation.js";

const data = new SlashCommandBuilder()
  .setName("kick")
  .setDescription("Kick a member from the server")
  .setDefaultMemberPermissions(P.KickMembers)
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) => o.setName("user").setDescription("Who to kick").setRequired(true))
  .addStringOption((o) => o.setName("reason").setDescription("Why").setMaxLength(500));

async function execute(interaction, ctx) {
  requireBotPermissions(interaction, [P.KickMembers]);
  const target = requireMember(interaction);
  requireCanModerate(interaction, target);
  if (!target.kickable) throw new UserError("I can't kick this member.");
  const reason = reasonOf(interaction);

  // DM first: after the kick we no longer share a server, so the DM would fail.
  const dmed = await tryDm(target.user, `👢 You were kicked from **${interaction.guild.name}**. Reason: ${reason}`);
  await target.kick(`${reason} (by ${interaction.user.tag})`);
  await logModeration(interaction, ctx, { action: "kick", title: "👢 Member kicked", target: target.user, reason });
  await interaction.reply({
    content: `👢 Kicked **${target.user.tag}**. Reason: ${reason}` + (dmed ? "" : "\n*(I couldn't DM them.)*"),
    allowedMentions: { parse: [] },
  });
}

export default { category: "Moderation (staff)", data, execute };
