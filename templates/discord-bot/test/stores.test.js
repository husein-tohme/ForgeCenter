import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.js";
import { getSettings, updateSettings } from "../src/lib/settings.js";
import {
  claimTicket, closeTicket, createTicket, deleteTicket, findOpenTicketByUser, findTicketByChannel, setTicketChannel,
} from "../src/lib/ticketStore.js";
import { getRolePanel, saveRolePanel } from "../src/lib/rolePanels.js";

test("settings start empty, can be changed and cleared", () => {
  const db = openDatabase(":memory:");
  assert.equal(getSettings(db, "g").logChannelId, null);
  updateSettings(db, "g", { logChannelId: "111", staffRoleId: "222" });
  updateSettings(db, "g", { welcomeMessage: "hi {user}" });
  const s = getSettings(db, "g");
  assert.equal(s.logChannelId, "111");
  assert.equal(s.staffRoleId, "222");
  assert.equal(s.welcomeMessage, "hi {user}");
  assert.equal(getSettings(db, "other").logChannelId, null);
  assert.equal(updateSettings(db, "g", { logChannelId: null }).logChannelId, null);
  assert.throws(() => updateSettings(db, "g", { "1; DROP TABLE x": "y" }), /Unknown setting/);
});

test("big Discord IDs survive the round trip exactly", () => {
  const db = openDatabase(":memory:");
  const id = "1234567890123456789"; // bigger than Number.MAX_SAFE_INTEGER
  updateSettings(db, id, { autoRoleId: id });
  assert.equal(getSettings(db, id).autoRoleId, id);
});

test("only one open ticket per member", () => {
  const db = openDatabase(":memory:");
  const { ticket } = createTicket(db, { guildId: "g", userId: "u", now: 1 });
  assert.equal(ticket.id, 1);
  assert.equal(createTicket(db, { guildId: "g", userId: "u" }).existing.id, 1);
  assert.ok(createTicket(db, { guildId: "other", userId: "u" }).ticket, "different server is fine");
  // The database itself refuses a second open ticket, even if code skips the check.
  assert.throws(() => db.prepare("INSERT INTO tickets (guild_id, user_id, created_at) VALUES ('g', 'u', 2)").run());

  setTicketChannel(db, ticket.id, "chan");
  assert.equal(findTicketByChannel(db, "chan").userId, "u");
  closeTicket(db, ticket.id, "mod");
  assert.equal(findTicketByChannel(db, "chan"), null);
  assert.equal(findOpenTicketByUser(db, "g", "u"), null);
  assert.ok(createTicket(db, { guildId: "g", userId: "u" }).ticket, "can open a new one after closing");
});

test("claiming a ticket only works once", () => {
  const db = openDatabase(":memory:");
  const { ticket } = createTicket(db, { guildId: "g", userId: "u" });
  assert.equal(claimTicket(db, ticket.id, "mod1"), true);
  assert.equal(claimTicket(db, ticket.id, "mod2"), false);
  setTicketChannel(db, ticket.id, "c");
  assert.equal(findTicketByChannel(db, "c").claimedBy, "mod1");
});

test("a failed ticket reservation can be removed", () => {
  const db = openDatabase(":memory:");
  const { ticket } = createTicket(db, { guildId: "g", userId: "u" });
  deleteTicket(db, ticket.id);
  assert.equal(findOpenTicketByUser(db, "g", "u"), null);
});

test("role panels remember their roles", () => {
  const db = openDatabase(":memory:");
  assert.equal(getRolePanel(db, "m"), null);
  saveRolePanel(db, { messageId: "m", guildId: "g", channelId: "c", roleIds: ["1", "2", "3"] });
  assert.deepEqual(getRolePanel(db, "m"), { messageId: "m", guildId: "g", channelId: "c", roleIds: ["1", "2", "3"] });
});

test("a database file is created (with its folder) and reopened", () => {
  const dir = mkdtempSync(join(tmpdir(), "bot-db-"));
  try {
    const path = join(dir, "nested", "bot.db");
    const db = openDatabase(path);
    updateSettings(db, "g", { logChannelId: "1" });
    db.close();
    assert.ok(existsSync(path));
    const again = openDatabase(path);
    assert.equal(getSettings(again, "g").logChannelId, "1");
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
