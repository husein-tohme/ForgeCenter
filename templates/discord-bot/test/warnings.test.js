import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.js";
import { addWarning, clearWarnings, countWarnings, listWarnings, removeWarning } from "../src/lib/warnings.js";

function setup() {
  const db = openDatabase(":memory:");
  const warn = (userId, reason, now, guildId = "g") =>
    addWarning(db, { guildId, userId, moderatorId: "mod", reason, now });
  return { db, warn };
}

test("adding warnings counts them per member", () => {
  const { db, warn } = setup();
  assert.deepEqual(warn("u1", "spam", 1), { id: 1, total: 1 });
  assert.deepEqual(warn("u1", "rude", 2), { id: 2, total: 2 });
  assert.deepEqual(warn("u2", "spam", 3), { id: 3, total: 1 });
  assert.equal(countWarnings(db, "g", "u1"), 2);
});

test("warnings are kept separate per server", () => {
  const { db, warn } = setup();
  warn("u1", "a", 1, "server-a");
  warn("u1", "b", 2, "server-b");
  assert.equal(countWarnings(db, "server-a", "u1"), 1);
  assert.equal(listWarnings(db, "server-b", "u1")[0].reason, "b");
});

test("listing is newest first and limited", () => {
  const { db, warn } = setup();
  for (let i = 1; i <= 12; i++) warn("u1", `reason ${i}`, i);
  const rows = listWarnings(db, "g", "u1", 10);
  assert.equal(rows.length, 10);
  assert.equal(rows[0].reason, "reason 12");
  assert.deepEqual(Object.keys(rows[0]).sort(), ["createdAt", "id", "moderatorId", "reason", "userId"]);
});

test("removing one warning", () => {
  const { db, warn } = setup();
  const { id } = warn("u1", "oops", 1);
  assert.equal(removeWarning(db, "other-server", id), null, "can't remove another server's warning");
  assert.deepEqual(removeWarning(db, "g", id), { id, userId: "u1" });
  assert.equal(removeWarning(db, "g", id), null);
  assert.equal(countWarnings(db, "g", "u1"), 0);
});

test("clearing all of a member's warnings", () => {
  const { db, warn } = setup();
  warn("u1", "a", 1);
  warn("u1", "b", 2);
  warn("u2", "c", 3);
  assert.equal(clearWarnings(db, "g", "u1"), 2);
  assert.equal(countWarnings(db, "g", "u1"), 0);
  assert.equal(countWarnings(db, "g", "u2"), 1);
});
