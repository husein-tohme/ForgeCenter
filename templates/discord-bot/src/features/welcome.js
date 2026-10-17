// Welcome messages and the optional auto-role for new members (set with /setup welcome and /setup autorole).
import { userMention } from "discord.js";
import { getSettings, DEFAULT_WELCOME_MESSAGE } from "../lib/settings.js";
import { renderTemplate } from "../lib/template.js";
import { truncate } from "../lib/respond.js";
import { sendLog } from "./logging.js";

/** Values for the placeholders an admin can use in the welcome message. */
export function welcomeValues(member) {
  return {
    user: userMention(member.id),
    username: member.displayName,
    server: member.guild.name,
    membercount: member.guild.memberCount,
  };
}

export function renderWelcome(template, member) {
  return truncate(renderTemplate(template || DEFAULT_WELCOME_MESSAGE, welcomeValues(member)));
}

async function sendWelcome(member, settings) {
  if (!settings.welcomeChannelId) return;
  const channel = member.guild.channels.cache.get(settings.welcomeChannelId);
  if (!channel?.isTextBased()) return;
  await channel.send({
    content: renderWelcome(settings.welcomeMessage, member),
    allowedMentions: { users: [member.id] }, // only ever ping the new member
  });
}

async function giveAutoRole(member, settings, ctx) {
  if (!settings.autoRoleId || member.user.bot) return;
  const role = member.guild.roles.cache.get(settings.autoRoleId);
  if (!role || member.roles.cache.has(role.id)) return;
  try {
    await member.roles.add(role, "Auto-role for new members");
  } catch (error) {
    await sendLog(member.guild, ctx.db, {
      content: `⚠️ I couldn't give ${role} to ${member} (${error.message}). Make sure my role is above it in Server Settings > Roles.`,
    });
  }
}

function logFailures(results) {
  for (const r of results) if (r.status === "rejected") console.warn(`[welcome] ${r.reason?.message ?? r.reason}`);
}

/** guildMemberAdd */
export async function handleMemberJoin(member, ctx) {
  const settings = getSettings(ctx.db, member.guild.id);
  logFailures(
    await Promise.allSettled([
      sendWelcome(member, settings),
      // Members who still have to accept the server rules get the role once they do (see below).
      member.pending ? null : giveAutoRole(member, settings, ctx),
    ]),
  );
}

/** guildMemberUpdate: give the auto-role once a member accepts the server's rules screen. */
export async function handleMemberUpdate(oldMember, newMember, ctx) {
  if (oldMember.pending && !newMember.pending) {
    await giveAutoRole(newMember, getSettings(ctx.db, newMember.guild.id), ctx);
  }
}
