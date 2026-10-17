import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits as P } from "discord.js";
import {
  BOT_PERMISSIONS, inviteUrl, missingPermissions, moderationBlocker, permissionName, roleBlocker,
} from "../src/lib/permissions.js";

test("invite link has the right permissions integer and scopes", () => {
  assert.equal(BOT_PERMISSIONS, 1099780189206n);
  const url = new URL(inviteUrl("123"));
  assert.equal(url.searchParams.get("client_id"), "123");
  assert.equal(url.searchParams.get("permissions"), "1099780189206");
  assert.equal(url.searchParams.get("scope"), "bot applications.commands");
  assert.equal(BOT_PERMISSIONS & P.Administrator, 0n, "the bot should not ask for Administrator");
});

test("permission names read like Discord's settings screen", () => {
  assert.equal(permissionName("SendMessages"), "Send Messages");
  assert.equal(permissionName("ManageGuild"), "Manage Server");
  assert.equal(permissionName("ModerateMembers"), "Timeout Members");
  assert.deepEqual(missingPermissions(P.ViewChannel | P.SendMessages, [P.ViewChannel, P.SendMessages, P.AttachFiles]), ["Attach Files"]);
  assert.deepEqual(missingPermissions(null, [P.SendMessages]), ["Send Messages"]);
  assert.deepEqual(missingPermissions(P.Administrator, [P.BanMembers]), [], "admins have everything");
});

const people = { owner: "owner", mod: { id: "mod", position: 5 }, bot: { id: "bot", position: 8 } };
const check = (target, overrides = {}) =>
  moderationBlocker({ actor: people.mod, target, bot: people.bot, ownerId: people.owner, ...overrides });

test("moderators can act on members below them and below the bot", () => {
  assert.equal(check({ id: "kid", position: 1 }), null);
});

test("moderation is blocked by the role hierarchy", () => {
  assert.match(check({ id: "mod", position: 5 }), /yourself/);
  assert.match(check({ id: "bot", position: 8 }), /myself/);
  assert.match(check({ id: "owner", position: 0 }), /owner/);
  assert.match(check({ id: "peer", position: 5 }), /higher than yours/);
  assert.match(check({ id: "boss", position: 7 }), /higher than yours/);
});

test("the bot's own position matters unless checkBot is off", () => {
  const actor = { id: "admin", position: 20 };
  assert.match(check({ id: "x", position: 9 }, { actor }), /higher than mine/);
  assert.equal(check({ id: "x", position: 9 }, { actor, checkBot: false }), null);
});

test("the server owner can moderate anyone except themselves", () => {
  const actor = { id: "owner", position: 0 };
  assert.equal(check({ id: "x", position: 3 }, { actor }), null);
  assert.match(check({ id: "x", position: 99 }, { actor }), /higher than mine/);
});

test("roleBlocker protects against unsafe self-assignable roles", () => {
  const base = { guildId: "guild", botPosition: 10, actorPosition: 6 };
  const role = (extra) => ({ id: "r", position: 3, managed: false, permissions: 0n, ...extra });
  assert.equal(roleBlocker({ ...base, role: role() }), null);
  assert.match(roleBlocker({ ...base, role: role({ id: "guild" }) }), /@everyone/);
  assert.match(roleBlocker({ ...base, role: role({ managed: true }) }), /managed/);
  assert.match(roleBlocker({ ...base, role: role({ position: 10 }) }), /my highest role/);
  assert.match(roleBlocker({ ...base, role: role({ position: 7 }) }), /your highest role/);
  assert.equal(roleBlocker({ ...base, actorIsOwner: true, role: role({ position: 7 }) }), null);
  assert.match(roleBlocker({ ...base, role: role({ permissions: P.Administrator }) }), /admin permissions/);
  assert.match(roleBlocker({ ...base, role: role({ permissions: P.BanMembers | P.SendMessages }) }), /admin permissions/);
  assert.equal(roleBlocker({ ...base, role: role({ permissions: P.SendMessages | P.AttachFiles }) }), null);
});
