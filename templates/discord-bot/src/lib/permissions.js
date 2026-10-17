// Permission math: the invite link, readable permission names and role-hierarchy checks.
import { PermissionFlagsBits as P, PermissionsBitField } from "discord.js";

/** Everything the bot needs. Used to build the invite link. */
export const BOT_PERMISSIONS = [
  P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory, // talking
  P.ManageMessages, // /purge
  P.ManageChannels, // ticket channels
  P.ManageRoles, // reaction roles + auto-role
  P.KickMembers, P.BanMembers, P.ModerateMembers, // moderation (ModerateMembers = timeouts)
].reduce((all, flag) => all | flag, 0n);

export function inviteUrl(clientId) {
  return (
    `https://discord.com/oauth2/authorize?client_id=${clientId}` +
    `&permissions=${BOT_PERMISSIONS}&integration_type=0&scope=bot+applications.commands`
  );
}

// Names as they appear in Discord's settings screens, where they differ from the API names.
const DISPLAY_NAMES = {
  ManageGuild: "Manage Server",
  ModerateMembers: "Timeout Members",
  ViewChannel: "View Channels",
};

/** "SendMessages" -> "Send Messages" */
export function permissionName(flagName) {
  return DISPLAY_NAMES[flagName] ?? flagName.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Readable list of the permissions in `required` that `permissions` lacks. */
export function missingPermissions(permissions, required) {
  const have = new PermissionsBitField(permissions ?? 0n);
  return have.missing(required).map(permissionName);
}

/** Roles with any of these should never be self-assignable or auto-given. */
export const DANGEROUS_ROLE_PERMISSIONS = [
  P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels, P.ManageMessages,
  P.ManageWebhooks, P.KickMembers, P.BanMembers, P.ModerateMembers, P.MentionEveryone,
].reduce((all, flag) => all | flag, 0n);

/**
 * Why `actor` may not moderate `target` (or null if they may).
 * Each party is { id, position } where position is their highest role's position.
 * Set checkBot to false for actions the bot does not perform on Discord itself (warnings).
 */
export function moderationBlocker({ actor, target, bot, ownerId, checkBot = true }) {
  if (target.id === actor.id) return "You can't do that to yourself.";
  if (target.id === bot.id) return "I can't do that to myself.";
  if (target.id === ownerId) return "The server owner can't be moderated.";
  if (actor.id !== ownerId && target.position >= actor.position) {
    return "That member's highest role is the same as or higher than yours.";
  }
  if (checkBot && target.position >= bot.position) {
    return "That member's highest role is the same as or higher than mine. Drag my role higher in Server Settings > Roles.";
  }
  return null;
}

/**
 * Why a role can't be handed out by the bot (or null if it can). The reason reads after the role
 * name, e.g. "@VIP is higher than my highest role...".
 * role: { id, position, managed, permissions (bigint) }
 */
export function roleBlocker({ role, guildId, botPosition, actorPosition = Infinity, actorIsOwner = false }) {
  if (role.id === guildId) return "is @everyone, which everybody already has.";
  if (role.managed) return "is managed by a bot or integration, so nobody can be given it.";
  if (role.position >= botPosition) {
    return "is the same as or higher than my highest role. Drag my role above it in Server Settings > Roles.";
  }
  if (!actorIsOwner && role.position >= actorPosition) return "is the same as or higher than your highest role.";
  if ((BigInt(role.permissions ?? 0n) & DANGEROUS_ROLE_PERMISSIONS) !== 0n) {
    return "has moderator or admin permissions, so it isn't safe to hand out.";
  }
  return null;
}
