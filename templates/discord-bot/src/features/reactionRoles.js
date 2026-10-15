// Self-assignable roles with buttons ("reaction roles", but more reliable than emoji reactions).
// Flow: /roles panel -> admin picks roles in a private menu -> the panel is posted ->
// members press a role's button to add it, and press again to remove it.
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits as P, RoleSelectMenuBuilder,
} from "discord.js";
import { UserError } from "../lib/errors.js";
import { roleBlocker } from "../lib/permissions.js";
import { ephemeral, truncate } from "../lib/respond.js";
import { getRolePanel, saveRolePanel } from "../lib/rolePanels.js";
import { COLORS } from "./logging.js";

const DRAFT_TTL_MS = 10 * 60_000;
const drafts = new Map(); // draftId -> { title, description, userId }

const roleInfo = (role) => ({
  id: role.id,
  position: role.position,
  managed: role.managed,
  permissions: role.permissions.bitfield,
});

/** Step 1 (/roles panel): show the admin a private role picker. */
export async function startRolePanel(interaction, { title, description }) {
  if (!interaction.guild.members.me.permissions.has(P.ManageRoles)) {
    throw new UserError("I need the **Manage Roles** permission to hand out roles. Ask an admin to give it to my role.");
  }
  const draftId = interaction.id;
  drafts.set(draftId, { title, description, userId: interaction.user.id });
  setTimeout(() => drafts.delete(draftId), DRAFT_TTL_MS).unref();

  const menu = new RoleSelectMenuBuilder()
    .setCustomId(`roles:draft:${draftId}`)
    .setPlaceholder("Choose up to 25 roles")
    .setMinValues(1)
    .setMaxValues(25);
  await interaction.reply(
    ephemeral("Pick the roles members can give themselves. The panel will be posted in this channel.", {
      components: [new ActionRowBuilder().addComponents(menu)],
    }),
  );
}

export function rolePanelMessage({ title, description }, roles) {
  const list = roles.map((role) => `• ${role}`).join("\n");
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(title)
    .setDescription(truncate(`${description}\n\n${list}`, 4096))
    .setFooter({ text: "Press a button to get the role. Press it again to remove it." });

  const rows = [];
  for (let i = 0; i < roles.length; i += 5) {
    rows.push(
      new ActionRowBuilder().addComponents(
        roles.slice(i, i + 5).map((role) =>
          new ButtonBuilder().setCustomId(`rr:${role.id}`).setLabel(role.name.slice(0, 80)).setStyle(ButtonStyle.Secondary),
        ),
      ),
    );
  }
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}

/** Step 2 ("roles:draft:<id>" menu): the admin picked roles. Check each one, then post the panel. */
export async function finishRolePanel(interaction, ctx) {
  const draftId = interaction.customId.split(":")[2];
  const draft = drafts.get(draftId);
  if (!draft || draft.userId !== interaction.user.id) {
    throw new UserError("This setup timed out. Run `/roles panel` again.");
  }
  const { guild, member } = interaction;
  const usable = [];
  const skipped = [];
  for (const role of interaction.roles.values()) {
    const problem = roleBlocker({
      role: roleInfo(role),
      guildId: guild.id,
      botPosition: guild.members.me.roles.highest.position,
      actorPosition: member.roles.highest.position,
      actorIsOwner: guild.ownerId === member.id,
    });
    if (problem) skipped.push(`• ${role} ${problem}`);
    else usable.push(role);
  }
  if (!usable.length) throw new UserError(`None of those roles can be used:\n${skipped.join("\n")}`);

  usable.sort((a, b) => b.position - a.position);
  const message = await interaction.channel.send(rolePanelMessage(draft, usable));
  saveRolePanel(ctx.db, {
    messageId: message.id,
    guildId: guild.id,
    channelId: message.channelId,
    roleIds: usable.map((role) => role.id),
  });
  drafts.delete(draftId);

  const note = skipped.length ? `\n\nSkipped:\n${skipped.join("\n")}` : "";
  await interaction.update({
    content: truncate(`✅ Role panel posted with ${usable.length} role${usable.length === 1 ? "" : "s"}.${note}`),
    components: [],
    allowedMentions: { parse: [] },
  });
}

/** "rr:<roleId>" button: add the role, or remove it if the member already has it. */
export async function toggleRole(interaction, ctx) {
  const roleId = interaction.customId.split(":")[1];
  const panel = getRolePanel(ctx.db, interaction.message.id);
  if (!panel?.roleIds.includes(roleId)) {
    throw new UserError("This role panel is no longer active. Ask an admin to post a new one with `/roles panel`.");
  }
  const { guild, member } = interaction;
  const role = guild.roles.cache.get(roleId);
  if (!role) throw new UserError("That role no longer exists. Ask an admin to post a new panel.");
  const me = guild.members.me;
  if (!me.permissions.has(P.ManageRoles)) {
    throw new UserError("I lost the **Manage Roles** permission, so I can't hand out roles. Ask an admin to fix it.");
  }

  if (member.roles.cache.has(role.id)) {
    if (role.managed || role.position >= me.roles.highest.position) {
      throw new UserError(`I can't remove ${role} because it's higher than my highest role. Ask an admin to drag my role above it.`);
    }
    await member.roles.remove(role, "Role panel");
    return interaction.reply(ephemeral(`➖ Removed ${role}.`));
  }

  // Re-check before adding, in case the role was moved or given admin permissions since the panel was made.
  const problem = roleBlocker({ role: roleInfo(role), guildId: guild.id, botPosition: me.roles.highest.position, actorIsOwner: true });
  if (problem) throw new UserError(`Sorry, I can't give out ${role}: it ${problem} (An admin needs to fix this.)`);
  await member.roles.add(role, "Role panel");
  return interaction.reply(ephemeral(`✅ You now have ${role}!`));
}
