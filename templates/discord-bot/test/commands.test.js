// Checks every slash command definition without connecting to Discord.
import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationCommandOptionType, InteractionContextType, PermissionFlagsBits as P } from "discord.js";
import { buildRegistry, commands, commandsJson } from "../src/commands/index.js";
import { CATEGORY_ORDER, helpSections } from "../src/lib/help.js";

const json = commandsJson();
const byName = Object.fromEntries(json.map((c) => [c.name, c]));

test("all commands build and have unique names and button prefixes", () => {
  const { byName: names, components } = buildRegistry();
  assert.equal(names.size, commands.length);
  assert.deepEqual([...components.keys()].sort(), ["roles", "rr", "ticket", "trivia"]);
  assert.throws(() => buildRegistry([commands[0], commands[0]]), /Two commands/);
});

test("every requested command exists", () => {
  const expected = [
    "setup", "ticket", "roles", "meme", "8ball", "coinflip", "roll", "warn", "warnings", "timeout", "kick", "ban",
    "purge", "trivia", "rps", "daily", "balance", "leaderboard", "help", "serverinfo", "userinfo", "ping",
  ];
  assert.deepEqual(Object.keys(byName).sort(), expected.sort());
});

/** Walks all options (including inside subcommands). */
function* allOptions(options = []) {
  for (const option of options) {
    yield option;
    yield* allOptions(option.options);
  }
}

test("definitions stay within Discord's limits", () => {
  for (const command of json) {
    assert.match(command.name, /^[\w-]{1,32}$/u, command.name);
    assert.ok(command.description.length >= 1 && command.description.length <= 100, command.name);
    assert.ok((command.options ?? []).length <= 25, command.name);
    for (const option of allOptions(command.options)) {
      assert.match(option.name, /^[a-z0-9_-]{1,32}$/, `${command.name}.${option.name}`);
      assert.ok(option.description.length <= 100, `${command.name}.${option.name} description too long`);
    }
    // Discord counts names + descriptions + choices; the limit is 8000 characters.
    assert.ok(JSON.stringify(command).length < 8000, command.name);
  }
});

test("commands only work inside servers", () => {
  for (const command of json) assert.deepEqual(command.contexts, [InteractionContextType.Guild], command.name);
});

test("admin and moderator commands are hidden from regular members by default", () => {
  const expected = {
    setup: P.ManageGuild, ticket: P.ManageGuild, roles: P.ManageRoles, warn: P.ModerateMembers,
    warnings: P.ModerateMembers, timeout: P.ModerateMembers, kick: P.KickMembers, ban: P.BanMembers,
    purge: P.ManageMessages,
  };
  for (const [name, permission] of Object.entries(expected)) {
    assert.equal(byName[name].default_member_permissions, String(permission), name);
  }
  for (const name of ["meme", "trivia", "daily", "help", "ping"]) {
    assert.equal(byName[name].default_member_permissions ?? null, null, `${name} should be for everyone`);
  }
});

test("/purge accepts 1 to 100 messages", () => {
  const amount = byName.purge.options.find((o) => o.name === "amount");
  assert.equal(amount.min_value, 1);
  assert.equal(amount.max_value, 100);
});

test("/setup has the expected subcommands", () => {
  const subs = byName.setup.options.filter((o) => o.type === ApplicationCommandOptionType.Subcommand).map((o) => o.name);
  assert.deepEqual(subs, ["view", "logs", "tickets", "welcome", "autorole", "off"]);
});

test("every command has a known help category and shows up in /help", () => {
  for (const command of commands) assert.ok(CATEGORY_ORDER.includes(command.category), command.data.name);
  const sections = helpSections(commands);
  assert.deepEqual(sections.map((s) => s.category), CATEGORY_ORDER);
  const text = sections.flatMap((s) => s.lines).join("\n");
  for (const command of json) assert.ok(text.includes(`/${command.name}`), command.name);
  assert.ok(text.includes("`/setup tickets`"), "subcommands are listed individually");
  for (const s of sections) assert.ok(s.lines.join("\n").length <= 1024, `${s.category} is too long for one embed field`);
});
