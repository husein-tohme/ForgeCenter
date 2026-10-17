// /setup: admins configure the bot for their server. Everything is saved in the database.
import {
  ChannelType, EmbedBuilder, InteractionContextType, PermissionFlagsBits as P, SlashCommandBuilder,
  channelMention, roleMention,
} from "discord.js";
import { UserError } from "../lib/errors.js";
import { missingPermissions, roleBlocker } from "../lib/permissions.js";
import { ephemeral } from "../lib/respond.js";
import { DEFAULT_WELCOME_MESSAGE, getSettings, updateSettings } from "../lib/settings.js";
import { renderWelcome } from "../features/welcome.js";
import { COLORS } from "../features/logging.js";

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Set up the bot for this server")
  .setDefaultMemberPermissions(P.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName("view").setDescription("Show the current settings"))
  .addSubcommand((s) =>
    s.setName("logs").setDescription("Choose where moderation logs and ticket transcripts are posted")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("The log channel (staff only)").addChannelTypes(...TEXT_CHANNELS).setRequired(true)),
  )
  .addSubcommand((s) =>
    s.setName("tickets").setDescription("Choose where ticket channels go and who can see them")
      .addChannelOption((o) =>
        o.setName("category").setDescription("Category for new ticket channels").addChannelTypes(ChannelType.GuildCategory).setRequired(true))
      .addRoleOption((o) => o.setName("staff_role").setDescription("Role that can see and answer tickets").setRequired(true)),
  )
  .addSubcommand((s) =>
    s.setName("welcome").setDescription("Greet new members in a channel")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Where welcome messages are posted").addChannelTypes(...TEXT_CHANNELS).setRequired(true))
      .addStringOption((o) =>
        o.setName("message").setDescription("Placeholders: {user} {username} {server} {membercount}. Use \\n for a new line.").setMaxLength(1000)),
  )
  .addSubcommand((s) =>
    s.setName("autorole").setDescription("Give every new member a role automatically")
      .addRoleOption((o) => o.setName("role").setDescription("The role to give").setRequired(true)),
  )
  .addSubcommand((s) =>
    s.setName("off").setDescription("Turn a feature off")
      .addStringOption((o) =>
        o.setName("feature").setDescription("What to turn off").setRequired(true).addChoices(
          { name: "Log channel", value: "logs" },
          { name: "Tickets", value: "tickets" },
          { name: "Welcome messages", value: "welcome" },
          { name: "Auto-role", value: "autorole" },
        )),
  );

/** Makes sure the bot can do its job in a channel before saving it. */
function requireAccess(channel, guild, flags, label) {
  const missing = missingPermissions(channel.permissionsFor(guild.members.me), flags);
  if (missing.length) {
    throw new UserError(`I need **${missing.join("**, **")}** in ${channelMention(channel.id)} to use it as the ${label}.`);
  }
}

const show = (id, mention) => (id ? mention(id) : "Not set");

const FEATURES_OFF = {
  logs: { label: "the log channel", patch: { logChannelId: null } },
  tickets: { label: "tickets (existing ticket channels stay until closed)", patch: { ticketCategoryId: null, staffRoleId: null } },
  welcome: { label: "welcome messages (your message text is kept)", patch: { welcomeChannelId: null } },
  autorole: { label: "the auto-role", patch: { autoRoleId: null } },
};

function viewSettings(interaction, ctx) {
  const s = getSettings(ctx.db, interaction.guildId);
  const welcome = s.welcomeMessage ?? DEFAULT_WELCOME_MESSAGE;
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(`⚙️ Settings for ${interaction.guild.name}`)
    .addFields(
      { name: "Log channel", value: show(s.logChannelId, channelMention), inline: true },
      { name: "Ticket category", value: show(s.ticketCategoryId, channelMention), inline: true },
      { name: "Staff role", value: show(s.staffRoleId, roleMention), inline: true },
      { name: "Welcome channel", value: show(s.welcomeChannelId, channelMention), inline: true },
      { name: "Auto-role", value: show(s.autoRoleId, roleMention), inline: true },
      { name: "Welcome message", value: `\`\`\`\n${welcome.replace(/`/g, "'").slice(0, 1000)}\n\`\`\`` },
    );
  return interaction.reply(ephemeral(null, { embeds: [embed] }));
}

async function execute(interaction, ctx) {
  const { guild } = interaction;
  const sub = interaction.options.getSubcommand();
  const save = (patch) => updateSettings(ctx.db, guild.id, patch);

  if (sub === "view") return viewSettings(interaction, ctx);

  if (sub === "logs") {
    const channel = interaction.options.getChannel("channel", true);
    requireAccess(channel, guild, [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles], "log channel");
    save({ logChannelId: channel.id });
    return interaction.reply(ephemeral(`✅ Logs and ticket transcripts will be posted in ${channel}.`));
  }

  if (sub === "tickets") {
    const category = interaction.options.getChannel("category", true);
    const role = interaction.options.getRole("staff_role", true);
    if (role.id === guild.id) throw new UserError("Pick a staff role, not @everyone (otherwise everybody could read every ticket).");
    requireAccess(
      category, guild,
      [P.ViewChannel, P.ManageChannels, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks, P.AttachFiles],
      "ticket category",
    );
    save({ ticketCategoryId: category.id, staffRoleId: role.id });
    const hint = getSettings(ctx.db, guild.id).logChannelId ? "" : "\nTip: set a log channel with `/setup logs` so transcripts are saved.";
    return interaction.reply(
      ephemeral(`✅ Tickets will be created in **${category.name}** and ${role} can see them. Post the button with \`/ticket panel\`.${hint}`),
    );
  }

  if (sub === "welcome") {
    const channel = interaction.options.getChannel("channel", true);
    const message = interaction.options.getString("message");
    requireAccess(channel, guild, [P.ViewChannel, P.SendMessages], "welcome channel");
    const settings = save({ welcomeChannelId: channel.id, ...(message ? { welcomeMessage: message } : {}) });
    const preview = renderWelcome(settings.welcomeMessage, interaction.member);
    return interaction.reply(ephemeral(`✅ New members will be welcomed in ${channel}. Preview:\n\n${preview}`.slice(0, 2000)));
  }

  if (sub === "autorole") {
    const role = interaction.options.getRole("role", true);
    if (!guild.members.me.permissions.has(P.ManageRoles)) {
      throw new UserError("I need the **Manage Roles** permission to give roles. Ask an admin to give it to my role.");
    }
    const problem = roleBlocker({
      role: { id: role.id, position: role.position, managed: role.managed, permissions: role.permissions.bitfield },
      guildId: guild.id,
      botPosition: guild.members.me.roles.highest.position,
      actorPosition: interaction.member.roles.highest.position,
      actorIsOwner: guild.ownerId === interaction.user.id,
    });
    if (problem) throw new UserError(`${role} ${problem}`);
    save({ autoRoleId: role.id });
    return interaction.reply(ephemeral(`✅ New members will get ${role} automatically.`));
  }

  if (sub === "off") {
    const feature = interaction.options.getString("feature", true);
    const { patch, label } = FEATURES_OFF[feature];
    save(patch);
    return interaction.reply(ephemeral(`✅ Turned off ${label}.`));
  }
}

export default { category: "Setup (admins)", data, execute };
