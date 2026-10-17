// Warning records for /warn and /warnings.

/** Saves a warning and returns { id, total } where total is the member's warning count. */
export function addWarning(db, { guildId, userId, moderatorId, reason, now = Date.now() }) {
  const { lastInsertRowid } = db
    .prepare(
      "INSERT INTO warnings (guild_id, user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(guildId, userId, moderatorId, reason, now);
  return { id: Number(lastInsertRowid), total: countWarnings(db, guildId, userId) };
}

export function countWarnings(db, guildId, userId) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM warnings WHERE guild_id = ? AND user_id = ?")
    .get(guildId, userId).n;
}

/** Newest first. */
export function listWarnings(db, guildId, userId, limit = 10) {
  return db
    .prepare(
      `SELECT id, user_id AS userId, moderator_id AS moderatorId, reason, created_at AS createdAt
       FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(guildId, userId, limit)
    .map((row) => ({ ...row }));
}

/** Deletes one warning by its number. Returns the deleted warning, or null if not found. */
export function removeWarning(db, guildId, id) {
  const row = db
    .prepare("SELECT id, user_id AS userId FROM warnings WHERE guild_id = ? AND id = ?")
    .get(guildId, id);
  if (!row) return null;
  db.prepare("DELETE FROM warnings WHERE id = ?").run(id);
  return { ...row };
}

/** Deletes all of a member's warnings. Returns how many were removed. */
export function clearWarnings(db, guildId, userId) {
  return Number(
    db.prepare("DELETE FROM warnings WHERE guild_id = ? AND user_id = ?").run(guildId, userId).changes,
  );
}
