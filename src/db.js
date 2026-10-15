// SQLite database (built into Node 22.13+). One file, no separate server to run.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const path = process.env.DATABASE_PATH || "data/forgecenter.db";
if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

export const db = new DatabaseSync(path);
export const now = () => new Date().toISOString();

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- email is only ever set from a provider that verified it, because it decides
-- who can open the owner panel. WhatsApp-only accounts have a phone instead.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT,
  phone TEXT,
  name TEXT NOT NULL,
  picture TEXT,
  stripe_customer_id TEXT,
  created_at TEXT NOT NULL
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
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tutor_usage (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);
`);

// Upgrades for databases created by older versions.
const columns = table => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
if (!columns("mods").includes("kind")) db.exec("ALTER TABLE mods ADD COLUMN kind TEXT NOT NULL DEFAULT 'mod'");

// v0.2 stored one Google ID per user. Move it to identities and allow other providers.
if (columns("users").includes("google_sub")) {
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec(`BEGIN;
    CREATE TABLE users_new (
      id INTEGER PRIMARY KEY, email TEXT, phone TEXT, name TEXT NOT NULL, picture TEXT,
      stripe_customer_id TEXT, created_at TEXT NOT NULL
    );
    INSERT INTO users_new (id, email, name, picture, stripe_customer_id, created_at)
      SELECT id, email, name, picture, stripe_customer_id, created_at FROM users;
    INSERT INTO identities (provider, subject, user_id, display, created_at)
      SELECT 'google', google_sub, id, email, created_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
    CREATE INDEX IF NOT EXISTS users_email ON users(lower(email));
    COMMIT;`);
  db.exec("PRAGMA foreign_keys = ON");
}
