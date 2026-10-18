// SQLite database (built into Node 22.13+). One file, no separate server to run.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const path = process.env.DATABASE_PATH || "data/forgecenter.db";
if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

export const db = new DatabaseSync(path);
export const now = () => new Date().toISOString();
// Wallet balance in cents: the sum of the person's wallet entries.
export const walletBalance = userId =>
  db.prepare("SELECT COALESCE(SUM(amount), 0) AS c FROM wallet_entries WHERE user_id = ?").get(userId).c;

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
-- The bot runner shares this file, so wait briefly for its writes instead of failing.
PRAGMA busy_timeout = 5000;

-- email is only ever set from a provider that verified it, because it decides
-- who can open the owner panel. WhatsApp-only accounts have a phone instead.
-- AUTOINCREMENT so a deleted account's id is never given to someone new: other
-- systems (the game panel, Stripe metadata) remember users by id.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  phone TEXT,
  name TEXT NOT NULL,
  picture TEXT,
  stripe_customer_id TEXT,
  created_at TEXT NOT NULL,
  age_group TEXT,
  age_method TEXT,
  age_confirmed_at TEXT
);
CREATE INDEX IF NOT EXISTS users_email ON users(lower(email));

-- Each way a person can sign in (google, github, microsoft, discord, whatsapp).
CREATE TABLE IF NOT EXISTS identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX IF NOT EXISTS identities_user ON identities(user_id);

-- Short-lived state for GitHub, Microsoft and Discord sign-in redirects.
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  verifier TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  link_user_id INTEGER,
  return_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- WhatsApp sign-in codes and a log of sends for rate limiting.
CREATE TABLE IF NOT EXISTS whatsapp_codes (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS whatsapp_sends (
  id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL,
  ip TEXT,
  sent_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- status is the work status (awaiting_payment, paid, in_progress, delivered,
-- payment_failed, expired, canceled). subscription_status tracks recurring billing.
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  product TEXT NOT NULL,
  amount INTEGER NOT NULL,
  monthly INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  subscription_status TEXT,
  stripe_session_id TEXT UNIQUE,
  stripe_subscription_id TEXT,
  brief TEXT NOT NULL DEFAULT '',
  deliverable_url TEXT,
  paid_with TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS orders_sub ON orders(stripe_subscription_id);

CREATE TABLE IF NOT EXISTS order_messages (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_admin INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Saved creations from the free tools. kind is mod, texturepack or modpack.
CREATE TABLE IF NOT EXISTS mods (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'mod',
  name TEXT NOT NULL,
  modrinth_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS showcase (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  adult_only INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tutor_usage (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- What a paid order runs: a Minecraft server on Pterodactyl or a hosted Discord bot.
-- state: waiting_setup, provisioning, active, suspended, failed, deleted.
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  panel_server_id INTEGER,
  panel_identifier TEXT,
  address TEXT,
  bot_token_enc TEXT,
  bot_app_id TEXT,
  bot_name TEXT,
  bot_status TEXT,
  bot_started_at INTEGER,
  commands_registered INTEGER NOT NULL DEFAULT 0,
  restart_requested INTEGER NOT NULL DEFAULT 0,
  log_tail TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  delete_after INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Game panel accounts of deleted customers, waiting to be locked.
CREATE TABLE IF NOT EXISTS panel_cleanups (
  external_id TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);

-- Adult confirmations through Stripe: a credit card check (Checkout in setup mode)
-- or an ID scan with a selfie (Stripe Identity). Only the outcome is kept; dates of
-- birth, card details and ID images never reach this database.
CREATE TABLE IF NOT EXISTS age_checks (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  stripe_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS age_checks_user ON age_checks(user_id);

-- Wallet: store credit that can be spent on ForgeCenter. A balance is the sum of
-- the person's entries, so every change is on record. ref makes entries that come
-- from Stripe events idempotent.
CREATE TABLE IF NOT EXISTS wallet_topups (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL,
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT,
  refunded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS wallet_topups_pi ON wallet_topups(stripe_payment_intent);
CREATE TABLE IF NOT EXISTS wallet_entries (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL,
  order_id INTEGER REFERENCES orders(id),
  topup_id INTEGER REFERENCES wallet_topups(id),
  ref TEXT UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS wallet_entries_user ON wallet_entries(user_id);

-- Support tickets. status: ai (the assistant is answering), waiting (for the owner),
-- answered (the owner replied) or closed. author: customer, ai or staff.
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  category TEXT NOT NULL,
  order_id INTEGER REFERENCES orders(id),
  status TEXT NOT NULL,
  handoff_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tickets_user ON tickets(user_id);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ticket_messages_ticket ON ticket_messages(ticket_id);
CREATE TABLE IF NOT EXISTS support_usage (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
`);

// Upgrades for databases created by older versions.
const columns = table => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
if (!columns("mods").includes("kind")) db.exec("ALTER TABLE mods ADD COLUMN kind TEXT NOT NULL DEFAULT 'mod'");

// Rebuild users when it comes from an older version: v0.2 stored one Google ID per
// user (moved to identities), and versions before 0.4 could reuse deleted ids.
const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql ?? "";
const userColumns = columns("users");
if (userColumns.includes("google_sub") || !/AUTOINCREMENT/i.test(usersSql)) {
  const phone = userColumns.includes("phone") ? "phone" : "NULL";
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec(`BEGIN;
    CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, phone TEXT, name TEXT NOT NULL, picture TEXT,
      stripe_customer_id TEXT, created_at TEXT NOT NULL
    );
    INSERT INTO users_new (id, email, phone, name, picture, stripe_customer_id, created_at)
      SELECT id, email, ${phone}, name, picture, stripe_customer_id, created_at FROM users;
    ${userColumns.includes("google_sub") ? `INSERT INTO identities (provider, subject, user_id, display, created_at)
      SELECT 'google', google_sub, id, email, created_at FROM users;` : ""}
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
    CREATE INDEX IF NOT EXISTS users_email ON users(lower(email));
    COMMIT;`);
  db.exec("PRAGMA foreign_keys = ON");
}

// Columns added after the tables above first shipped. Feature modules use it for theirs too.
export const addColumn = (table, column, type) => {
  if (!columns(table).includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
};
addColumn("users", "age_group", "TEXT");
addColumn("users", "age_method", "TEXT");
addColumn("users", "age_confirmed_at", "TEXT");
// Set by the site owner (reports.js); several features hide a suspended account's content.
addColumn("users", "suspended_at", "TEXT");
addColumn("users", "terms_accepted_at", "TEXT");
addColumn("users", "terms_version", "TEXT");
addColumn("users", "suspended_reason", "TEXT");
addColumn("orders", "paid_with", "TEXT");
if (!columns("orders").includes("paid_at")) {
  addColumn("orders", "paid_at", "TEXT");
  // Older orders: anything that got past payment was paid when it was last updated, near enough.
  db.exec("UPDATE orders SET paid_at = updated_at WHERE status IN ('paid', 'in_progress', 'delivered')");
}
addColumn("showcase", "adult_only", "INTEGER NOT NULL DEFAULT 0");
