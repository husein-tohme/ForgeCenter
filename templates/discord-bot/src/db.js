// SQLite database using Node's built-in node:sqlite (Node 22.13+). One file, no server.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Discord IDs are stored as TEXT: they are bigger than JavaScript numbers can hold exactly.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id           TEXT PRIMARY KEY,
  log_channel_id     TEXT,
  ticket_category_id TEXT,
  staff_role_id      TEXT,
  welcome_channel_id TEXT,
  welcome_message    TEXT,
  auto_role_id       TEXT
);

CREATE TABLE IF NOT EXISTS warnings (
  id           INTEGER PRIMARY KEY,
  guild_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  reason       TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS warnings_member ON warnings(guild_id, user_id);

CREATE TABLE IF NOT EXISTS tickets (
  id          INTEGER PRIMARY KEY,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  channel_id  TEXT UNIQUE,
  claimed_by  TEXT,
  is_open     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  closed_at   INTEGER,
  closed_by   TEXT
);
-- One open ticket per user per server, enforced by the database itself.
CREATE UNIQUE INDEX IF NOT EXISTS tickets_one_open ON tickets(guild_id, user_id) WHERE is_open = 1;

CREATE TABLE IF NOT EXISTS role_panels (
  message_id TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  role_ids   TEXT NOT NULL, -- comma separated
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS economy (
  guild_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  balance      INTEGER NOT NULL DEFAULT 0,
  last_daily   INTEGER,
  daily_streak INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS economy_rank ON economy(guild_id, balance DESC);
`;

/** Opens (or creates) the database and makes sure all tables exist. Use ":memory:" in tests. */
export function openDatabase(path = ":memory:") {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  return db;
}
