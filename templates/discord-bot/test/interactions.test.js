// The interaction router must answer every interaction, even when a handler fails.
import test from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { createInteractionHandler } from "../src/interactions.js";
import { UserError } from "../src/lib/errors.js";

function fakeInteraction({ command, customId, inGuild = true } = {}) {
  const calls = [];
  const interaction = {
    calls,
    commandName: command,
    customId,
    replied: false,
    deferred: false,
    type: 2,
    isAutocomplete: () => false,
    inCachedGuild: () => inGuild,
    isChatInputCommand: () => Boolean(command),
    isMessageComponent: () => Boolean(customId),
    isModalSubmit: () => false,
    reply: async (payload) => { calls.push(["reply", payload]); interaction.replied = true; },
    followUp: async (payload) => { calls.push(["followUp", payload]); },
    editReply: async (payload) => { calls.push(["editReply", payload]); },
    deferReply: async () => { interaction.deferred = true; },
  };
  return interaction;
}

function router(handlers = {}, components = {}) {
  const commands = new Map(Object.entries(handlers).map(([name, execute]) => [name, { execute }]));
  return createInteractionHandler({ commands, components: new Map(Object.entries(components)), ctx: { marker: 1 } });
}

const quiet = (t) => t.mock.method(console, "error", () => {});

test("runs the matching command with the shared context", async () => {
  let seen;
  const i = fakeInteraction({ command: "ping" });
  await router({ ping: async (interaction, ctx) => { seen = ctx; await interaction.reply({ content: "pong" }); } })(i);
  assert.deepEqual(seen, { marker: 1 });
  assert.deepEqual(i.calls, [["reply", { content: "pong" }]]);
});

test("a UserError is shown privately, word for word", async () => {
  const i = fakeInteraction({ command: "x" });
  await router({ x: async () => { throw new UserError("Tickets aren't set up yet."); } })(i);
  const [[kind, payload]] = i.calls;
  assert.equal(kind, "reply");
  assert.equal(payload.content, "❌ Tickets aren't set up yet.");
  assert.equal(payload.flags, MessageFlags.Ephemeral);
});

test("an unexpected crash gets a generic private reply and does not throw", async (t) => {
  const errors = quiet(t);
  const i = fakeInteraction({ command: "x" });
  await router({ x: async () => { throw new Error("database exploded"); } })(i);
  assert.match(i.calls[0][1].content, /Something went wrong/);
  assert.ok(!i.calls[0][1].content.includes("database exploded"), "internal details are not shown");
  assert.equal(errors.mock.callCount(), 1, "the real error is logged");
});

test("errors after deferReply edit the 'thinking' message", async (t) => {
  quiet(t);
  const i = fakeInteraction({ command: "x" });
  await router({ x: async (interaction) => { await interaction.deferReply(); throw new Error("boom"); } })(i);
  assert.equal(i.calls[0][0], "editReply");
});

test("errors after a reply become a private follow-up", async () => {
  const i = fakeInteraction({ command: "x" });
  await router({ x: async (interaction) => { await interaction.reply({ content: "ok" }); throw new UserError("later"); } })(i);
  assert.equal(i.calls[1][0], "followUp");
  assert.equal(i.calls[1][1].flags, MessageFlags.Ephemeral);
});

test("unknown commands and buttons still get an answer", async () => {
  const a = fakeInteraction({ command: "gone" });
  await router()(a);
  assert.match(a.calls[0][1].content, /no longer exists/);
  const b = fakeInteraction({ customId: "old:thing" });
  await router()(b);
  assert.match(b.calls[0][1].content, /no longer active/);
});

test("buttons are routed by the part of the customId before the colon", async () => {
  let got;
  const i = fakeInteraction({ customId: "ticket:open" });
  await router({}, { ticket: async (interaction) => { got = interaction.customId; await interaction.reply({ content: "ok" }); } })(i);
  assert.equal(got, "ticket:open");
});

test("a handler that forgets to reply still produces an answer", async () => {
  const i = fakeInteraction({ command: "silent" });
  await router({ silent: async () => {} })(i);
  assert.equal(i.calls.length, 1);
  assert.equal(i.calls[0][1].flags, MessageFlags.Ephemeral);
});

test("commands used outside a server are refused politely", async () => {
  const i = fakeInteraction({ command: "ping", inGuild: false });
  let ran = false;
  await router({ ping: async () => { ran = true; } })(i);
  assert.equal(ran, false);
  assert.match(i.calls[0][1].content, /inside a server/);
});

test("if even the error reply fails, nothing is thrown", async (t) => {
  const errors = quiet(t);
  const i = fakeInteraction({ command: "x" });
  i.reply = async () => { throw new Error("Unknown interaction"); };
  await router({ x: async () => { throw new Error("boom"); } })(i);
  assert.equal(errors.mock.callCount(), 2);
});
