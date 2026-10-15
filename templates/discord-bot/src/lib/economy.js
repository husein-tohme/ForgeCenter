// Coins: /daily, /balance, /leaderboard and trivia rewards.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const STREAK_BONUS = 10; // extra coins per day of streak
export const MAX_STREAK_DAYS = 7; // bonus stops growing after a week

/**
 * Pure daily-reward math.
 * - You can claim once every 24 hours.
 * - Claiming again within 48 hours of your last claim keeps your streak going.
 * - Each streak day adds STREAK_BONUS coins, up to MAX_STREAK_DAYS.
 */
export function dailyReward({ lastDaily, streak = 0, now, base }) {
  if (lastDaily != null && now - lastDaily < DAY_MS) {
    return { ok: false, retryInMs: lastDaily + DAY_MS - now };
  }
  const keepsStreak = lastDaily != null && now - lastDaily < 2 * DAY_MS;
  const newStreak = keepsStreak ? streak + 1 : 1;
  const bonus = STREAK_BONUS * (Math.min(newStreak, MAX_STREAK_DAYS) - 1);
  return { ok: true, amount: base + bonus, bonus, streak: newStreak };
}

function getRow(db, guildId, userId) {
  return db
    .prepare("SELECT balance, last_daily, daily_streak FROM economy WHERE guild_id = ? AND user_id = ?")
    .get(guildId, userId);
}

/** Claims /daily. Returns { ok, amount, bonus, streak, balance } or { ok: false, retryInMs }. */
export function claimDaily(db, guildId, userId, { base, now = Date.now() }) {
  const row = getRow(db, guildId, userId);
  const result = dailyReward({ lastDaily: row?.last_daily ?? null, streak: row?.daily_streak ?? 0, now, base });
  if (!result.ok) return result;

  const { balance } = db
    .prepare(
      `INSERT INTO economy (guild_id, user_id, balance, last_daily, daily_streak) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (guild_id, user_id) DO UPDATE SET
         balance = balance + excluded.balance,
         last_daily = excluded.last_daily,
         daily_streak = excluded.daily_streak
       RETURNING balance`,
    )
    .get(guildId, userId, result.amount, now, result.streak);
  return { ...result, balance };
}

/** Adds (or with a negative amount, removes) coins. Returns the new balance. */
export function addCoins(db, guildId, userId, amount) {
  return db
    .prepare(
      `INSERT INTO economy (guild_id, user_id, balance) VALUES (?, ?, ?)
       ON CONFLICT (guild_id, user_id) DO UPDATE SET balance = balance + excluded.balance
       RETURNING balance`,
    )
    .get(guildId, userId, amount).balance;
}

export function getBalance(db, guildId, userId) {
  return getRow(db, guildId, userId)?.balance ?? 0;
}

/** 1 = richest. null when the member has no coins yet. */
export function getRank(db, guildId, userId) {
  const balance = getBalance(db, guildId, userId);
  if (balance <= 0) return null;
  const { n } = db
    .prepare("SELECT COUNT(*) AS n FROM economy WHERE guild_id = ? AND balance > ?")
    .get(guildId, balance);
  return n + 1;
}

/** Top members by balance: [{ userId, balance }]. */
export function leaderboard(db, guildId, limit = 10) {
  return db
    .prepare(
      `SELECT user_id AS userId, balance FROM economy
       WHERE guild_id = ? AND balance > 0 ORDER BY balance DESC, user_id LIMIT ?`,
    )
    .all(guildId, limit)
    .map((row) => ({ ...row }));
}
