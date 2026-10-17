// Support tickets: a panel with an "Open ticket" button, private ticket channels,
// Claim and Close buttons, and a .txt transcript in the log channel when a ticket closes.
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder,
  MessageFlags, OverwriteType, PermissionFlagsBits as P, roleMention, time, userMention,
} from "discord.js";
import { UserError } from "../lib/errors.js";
import { missingPermissions } from "../lib/permissions.js";
import { ephemeral } from "../lib/respond.js";
import { getSettings } from "../lib/settings.js";
import {
  claimTicket, closeTicket, createTicket, deleteTicket, findOpenTicketByUser, findTicketByChannel,
  setTicketChannel,
} from "../lib/ticketStore.js";
import { formatTranscript } from "../lib/transcript.js";
import { COLORS, sendLog } from "./logging.js";

const MAX_TRANSCRIPT_MESSAGES = 5000;
const DELETE_DELAY_MS = 5000;
// What the ticket owner, staff and the bot can do inside a ticket channel.
const TICKET_ACCESS = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];

/** "ticket-0042-steve". Pure, so it is unit tested. */
export function ticketChannelName(ticketId, username) {
  const slug = String(username).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20);
  return `ticket-${String(ticketId).padStart(4, "0")}-${slug || "user"}`;
}

export function ticketPanelMessage({ title, description }) {
  const embed = new EmbedBuilder().setColor(COLORS.info).setTitle(title).setDescription(description);
  const button = new ButtonBuilder()
    .setCustomId("ticket:open").setLabel("Open ticket").setEmoji("🎫").setStyle(ButtonStyle.Primary);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] };
}

function ticketControls({ claimedByName } = {}) {
  const close = new ButtonBuilder()
    .setCustomId("ticket:close").setLabel("Close").setEmoji("🔒").setStyle(ButtonStyle.Danger);
  const claim = new ButtonBuilder()
    .setCustomId("ticket:claim").setEmoji("🙋").setStyle(ButtonStyle.Success)
    .setLabel(claimedByName ? `Claimed by ${claimedByName}`.slice(0, 80) : "Claim")
    .setDisabled(Boolean(claimedByName));
  return new ActionRowBuilder().addComponents(close, claim);
}

function isStaff(member, settings) {
  return (settings.staffRoleId && member.roles.cache.has(settings.staffRoleId)) || member.permissions.has(P.ManageChannels);
}

function requireTicket(ctx, interaction) {
  const ticket = findTicketByChannel(ctx.db, interaction.channelId);
  if (!ticket) throw new UserError("This channel isn't an open ticket (it may already be closed).");
  return ticket;
}

// ---- Open ----

async function openTicket(interaction, ctx) {
  const { guild, user } = interaction;
  const settings = getSettings(ctx.db, guild.id);
  if (!settings.ticketCategoryId || !settings.staffRoleId) {
    throw new UserError("Tickets aren't set up yet. An admin needs to run `/setup tickets` first.");
  }
  const category = guild.channels.cache.get(settings.ticketCategoryId);
  if (category?.type !== ChannelType.GuildCategory) {
    throw new UserError("The ticket category was deleted. An admin needs to run `/setup tickets` again.");
  }
  const staffRole = guild.roles.cache.get(settings.staffRoleId);
  if (!staffRole) throw new UserError("The staff role was deleted. An admin needs to run `/setup tickets` again.");

  const missing = missingPermissions(category.permissionsFor(guild.members.me), [P.ManageChannels, ...TICKET_ACCESS]);
  if (missing.length) {
    throw new UserError(`I need **${missing.join("**, **")}** in the ticket category. Ask an admin to fix my permissions.`);
  }

  const existing = findOpenTicketByUser(ctx.db, guild.id, user.id);
  if (existing?.channelId && guild.channels.cache.has(existing.channelId)) {
    throw new UserError(`You already have an open ticket: <#${existing.channelId}>`);
  }
  if (existing && !existing.channelId && Date.now() - existing.createdAt < 60_000) {
    throw new UserError("Your ticket is being created, hang on a second!");
  }
  // The old ticket's channel was deleted by hand: forget it so a new one can be opened.
  if (existing) closeTicket(ctx.db, existing.id, null);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { ticket } = createTicket(ctx.db, { guildId: guild.id, userId: user.id });
  if (!ticket) throw new UserError("You already have an open ticket.");

  let channel;
  try {
    channel = await guild.channels.create({
      name: ticketChannelName(ticket.id, user.username),
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `Ticket #${ticket.id} for ${user.tag} (${user.id})`,
      reason: `Ticket #${ticket.id} opened by ${user.tag}`,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.ViewChannel] },
        { id: staffRole.id, type: OverwriteType.Role, allow: TICKET_ACCESS },
        { id: user.id, type: OverwriteType.Member, allow: TICKET_ACCESS },
        { id: guild.members.me.id, type: OverwriteType.Member, allow: TICKET_ACCESS },
      ],
    });
  } catch (error) {
    deleteTicket(ctx.db, ticket.id);
    throw error;
  }
  setTicketChannel(ctx.db, ticket.id, channel.id);

  const welcome = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(`🎫 Ticket #${String(ticket.id).padStart(4, "0")}`)
    .setDescription(
      `Thanks for reaching out, ${user}! Tell us what you need help with and a staff member will be with you soon.\n\n` +
        "When everything is sorted, press **Close**.",
    );
  await channel.send({
    content: `${userMention(user.id)} ${roleMention(staffRole.id)}`,
    embeds: [welcome],
    components: [ticketControls()],
    allowedMentions: { users: [user.id], roles: [staffRole.id] },
  });
  await interaction.editReply(`✅ Your ticket is ready: ${channel}`);
}

// ---- Claim ----

async function claim(interaction, ctx) {
  const ticket = requireTicket(ctx, interaction);
  if (!isStaff(interaction.member, getSettings(ctx.db, interaction.guildId))) {
    throw new UserError("Only staff can claim tickets.");
  }
  if (!claimTicket(ctx.db, ticket.id, interaction.user.id)) {
    const current = findTicketByChannel(ctx.db, interaction.channelId);
    throw new UserError(`This ticket was already claimed by ${userMention(current?.claimedBy ?? "0")}.`);
  }
  await interaction.update({ components: [ticketControls({ claimedByName: interaction.member.displayName })] });
  await interaction.followUp({
    content: `🙋 ${interaction.user} has claimed this ticket and will help you.`,
    allowedMentions: { parse: [] },
  });
}

// ---- Close ----

function requireCanClose(interaction, ctx, ticket) {
  const settings = getSettings(ctx.db, interaction.guildId);
  if (ticket.userId !== interaction.user.id && !isStaff(interaction.member, settings)) {
    throw new UserError("Only the person who opened this ticket or staff can close it.");
  }
}

async function askToClose(interaction, ctx) {
  requireCanClose(interaction, ctx, requireTicket(ctx, interaction));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket:close-confirm").setLabel("Yes, close it").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("ticket:close-cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply(
    ephemeral("Close this ticket? A transcript will be saved and this channel will be deleted.", { components: [row] }),
  );
}

/** Fetches up to MAX_TRANSCRIPT_MESSAGES messages, 100 at a time. */
async function fetchAllMessages(channel) {
  const messages = [];
  let before;
  while (messages.length < MAX_TRANSCRIPT_MESSAGES) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    messages.push(...batch.values());
    if (batch.size < 100) break;
    before = batch.last().id; // batches come newest first
  }
  return messages.map((m) => ({
    createdAt: m.createdTimestamp,
    author: m.author.tag,
    bot: m.author.bot,
    content: m.content,
    attachments: m.attachments.map((a) => a.url),
    embeds: m.embeds.length,
  }));
}

const closing = new Set(); // channel IDs being closed right now, so a double click can't close twice

async function confirmClose(interaction, ctx) {
  const ticket = requireTicket(ctx, interaction);
  requireCanClose(interaction, ctx, ticket);
  if (closing.has(interaction.channelId)) throw new UserError("This ticket is already being closed.");
  closing.add(interaction.channelId);
  try {
    await archiveAndClose(interaction, ctx, ticket);
  } finally {
    closing.delete(interaction.channelId);
  }
}

async function archiveAndClose(interaction, ctx, ticket) {
  const { guild, channel, user } = interaction;
  await interaction.update({ content: "🔒 Closing the ticket and saving the transcript…", components: [] });

  const opener = await interaction.client.users.fetch(ticket.userId).catch(() => null);
  const messages = await fetchAllMessages(channel);
  const transcript = formatTranscript({
    ticketId: ticket.id,
    guildName: guild.name,
    channelName: channel.name,
    openedBy: opener ? `${opener.tag} (${opener.id})` : ticket.userId,
    closedBy: `${user.tag} (${user.id})`,
    messages,
  });

  const summary = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle(`🎫 Ticket #${String(ticket.id).padStart(4, "0")} closed`)
    .addFields(
      { name: "Opened by", value: userMention(ticket.userId), inline: true },
      { name: "Closed by", value: userMention(user.id), inline: true },
      { name: "Claimed by", value: ticket.claimedBy ? userMention(ticket.claimedBy) : "Nobody", inline: true },
      { name: "Opened", value: time(new Date(ticket.createdAt), "R"), inline: true },
      { name: "Messages", value: String(messages.length), inline: true },
    )
    .setTimestamp();
  const file = new AttachmentBuilder(Buffer.from(transcript, "utf8"), { name: `ticket-${ticket.id}.txt` });
  const logged = await sendLog(guild, ctx.db, { embeds: [summary], files: [file] });
  if (logged === false) {
    throw new UserError(
      "I couldn't post the transcript to the log channel, so I left this ticket open. " +
        "Check that I can View Channel, Send Messages and Attach Files in the log channel.",
    );
  }

  closeTicket(ctx.db, ticket.id, user.id);
  await channel.send({
    content:
      `🔒 Ticket closed by ${user}. ` +
      (logged ? "The transcript was saved. " : "No log channel is set, so no transcript was saved. ") +
      `This channel will be deleted in ${DELETE_DELAY_MS / 1000} seconds.`,
    allowedMentions: { parse: [] },
  });
  setTimeout(() => {
    channel.delete(`Ticket #${ticket.id} closed by ${user.tag}`).catch((error) =>
      console.warn(`[tickets] Could not delete #${channel.name}: ${error.message}`),
    );
  }, DELETE_DELAY_MS);
}

async function cancelClose(interaction) {
  await interaction.update({ content: "Okay, the ticket stays open.", components: [] });
}

/** Handles every button whose customId starts with "ticket:". */
export async function handleTicketButton(interaction, ctx) {
  const action = interaction.customId.split(":")[1];
  if (action === "open") return openTicket(interaction, ctx);
  if (action === "claim") return claim(interaction, ctx);
  if (action === "close") return askToClose(interaction, ctx);
  if (action === "close-confirm") return confirmClose(interaction, ctx);
  if (action === "close-cancel") return cancelClose(interaction);
  throw new UserError("This button is no longer active.");
}
