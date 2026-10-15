// Remembers which roles each reaction-role panel offers, so only those roles can be toggled.

export function saveRolePanel(db, { messageId, guildId, channelId, roleIds, now = Date.now() }) {
  db.prepare(
    `INSERT INTO role_panels (message_id, guild_id, channel_id, role_ids, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (message_id) DO UPDATE SET role_ids = excluded.role_ids`,
  ).run(messageId, guildId, channelId, roleIds.join(","), now);
}

/** Returns { messageId, guildId, channelId, roleIds } or null. */
export function getRolePanel(db, messageId) {
  const row = db
    .prepare("SELECT message_id, guild_id, channel_id, role_ids FROM role_panels WHERE message_id = ?")
    .get(messageId);
  if (!row) return null;
  return {
    messageId: row.message_id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    roleIds: row.role_ids.split(",").filter(Boolean),
  };
}
