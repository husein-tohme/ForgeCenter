// Per-server settings chosen with /setup.

// Setting name -> database column. Only these keys can be written.
const COLUMNS = {
  logChannelId: "log_channel_id",
  ticketCategoryId: "ticket_category_id",
  staffRoleId: "staff_role_id",
  welcomeChannelId: "welcome_channel_id",
  welcomeMessage: "welcome_message",
  autoRoleId: "auto_role_id",
};

export const DEFAULT_WELCOME_MESSAGE =
  "👋 Welcome to **{server}**, {user}! You are member #{membercount}.";

/** Returns the settings for a server. Unset values are null. */
export function getSettings(db, guildId) {
  const row = db.prepare("SELECT * FROM guild_settings WHERE guild_id = ?").get(guildId);
  const settings = {};
  for (const [key, column] of Object.entries(COLUMNS)) settings[key] = row?.[column] ?? null;
  return settings;
}

/** Changes some settings, e.g. updateSettings(db, id, { logChannelId: "123" }). null clears one. */
export function updateSettings(db, guildId, patch) {
  db.prepare("INSERT INTO guild_settings (guild_id) VALUES (?) ON CONFLICT DO NOTHING").run(guildId);
  for (const [key, value] of Object.entries(patch)) {
    const column = COLUMNS[key];
    if (!column) throw new Error(`Unknown setting: ${key}`);
    db.prepare(`UPDATE guild_settings SET ${column} = ? WHERE guild_id = ?`).run(value ?? null, guildId);
  }
  return getSettings(db, guildId);
}
