import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.js";
import {
  addCoins, claimDaily, dailyReward, DAY_MS, getBalance, getRank, leaderboard, MAX_STREAK_DAYS, STREAK_BONUS,
} from "../src/lib/economy.js";

const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 1);

test("first daily claim pays the base amount and starts a streak", () => {
  assert.deepEqual(dailyReward({ lastDaily: null, now: T0, base: 100 }), { ok: true, amount: 100, bonus: 0, streak: 1 });
});

test("claiming again within 24 hours is refused with the time left", () => {
  const r = dailyReward({ lastDaily: T0, streak: 1, now: T0 + 5 * HOUR, base: 100 });
  assert.equal(r.ok, false);
  assert.equal(r.retryInMs, 19 * HOUR);
});

test("claiming between 24 and 48 hours later keeps the streak and adds a bonus", () => {
  const r = dailyReward({ lastDaily: T0, streak: 1, now: T0 + DAY_MS + HOUR, base: 100 });
  assert.deepEqual(r, { ok: true, amount: 100 + STREAK_BONUS, bonus: STREAK_BONUS, streak: 2 });
});

test("waiting more than 48 hours resets the streak", () => {
  const r = dailyReward({ lastDaily: T0, streak: 5, now: T0 + 2 * DAY_MS + 1, base: 100 });
  assert.equal(r.streak, 1);
  assert.equal(r.amount, 100);
});

test("the streak bonus stops growing after a week", () => {
  const r = dailyReward({ lastDaily: T0, streak: 30, now: T0 + DAY_MS, base: 100 });
  assert.equal(r.streak, 31);
  assert.equal(r.bonus, STREAK_BONUS * (MAX_STREAK_DAYS - 1));
});

test("claimDaily stores balance, cooldown and streak", () => {
  const db = openDatabase(":memory:");
  const first = claimDaily(db, "g", "u", { base: 100, now: T0 });
  assert.equal(first.balance, 100);
  assert.equal(claimDaily(db, "g", "u", { base: 100, now: T0 + HOUR }).ok, false);
  const second = claimDaily(db, "g", "u", { base: 100, now: T0 + DAY_MS });
  assert.equal(second.streak, 2);
  assert.equal(second.balance, 210);
  assert.equal(getBalance(db, "g", "u"), 210);
});

test("addCoins, ranks and the leaderboard", () => {
  const db = openDatabase(":memory:");
  assert.equal(getBalance(db, "g", "nobody"), 0);
  assert.equal(getRank(db, "g", "nobody"), null);
  addCoins(db, "g", "a", 50);
  addCoins(db, "g", "b", 300);
  assert.equal(addCoins(db, "g", "a", 25), 75);
  addCoins(db, "g", "c", 10);
  addCoins(db, "other-server", "z", 9999);
  assert.deepEqual(leaderboard(db, "g"), [
    { userId: "b", balance: 300 },
    { userId: "a", balance: 75 },
    { userId: "c", balance: 10 },
  ]);
  assert.equal(getRank(db, "g", "b"), 1);
  assert.equal(getRank(db, "g", "c"), 3);
  assert.equal(leaderboard(db, "g", 2).length, 2);
});

test("trivia coins and daily coins add up in one balance", () => {
  const db = openDatabase(":memory:");
  addCoins(db, "g", "u", 25);
  assert.equal(claimDaily(db, "g", "u", { base: 100, now: T0 }).balance, 125);
});
