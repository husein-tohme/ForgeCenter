// Forge, the AI coding mentor. Signed-in users get a daily message allowance.
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { db, now, walletBalance } from "./db.js";
import { isAdult, requireUser } from "./auth.js";
import { rateLimit } from "./limit.js";
import { paidOrderCount } from "./orders.js";
import { orbs } from "./catalog.js";
import { addEntry, transaction, aiOrbsOn, ORBS_PER_AI_UNIT } from "./wallet.js";

export const FREE_DAILY = 30;
export const AI_PLAN_DAILY = 300;
export { ORBS_PER_AI_UNIT };

// AI spends already given back, so a refund that runs twice (say, a queued job retried
// after a restart) only gives back once. Rows are only needed for a few days.
db.exec(`CREATE TABLE IF NOT EXISTS ai_refunds (
  ref TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
)`);

const SYSTEM = `You are Forge, the ForgeCenter coding mentor. Your goal is to turn the learner into a professional developer.
Teach step by step, find out what they already know, give small exercises, review their code honestly, and explain the "why".
You also help plan Minecraft mods, Discord bots, websites and games. Many learners are young, so keep explanations clear and kind.`;
// Accounts are in the teen group until an adult confirms their age (see age.js).
const TEEN_NOTE = "\n\nThis learner's account is in the teen age group. Keep every example, project idea and topic suitable for teenagers.";

let client;
const ai = () => (process.env.ANTHROPIC_API_KEY ? (client ??= new Anthropic()) : null);
const today = () => new Date().toISOString().slice(0, 10);
export const dailyLimit = userId => (paidOrderCount(userId, "ai") > 0 ? AI_PLAN_DAILY : FREE_DAILY);
const usedOn = (userId, day) =>
  db.prepare("SELECT count FROM tutor_usage WHERE user_id = ? AND day = ?").get(userId, day)?.count ?? 0;
const usedToday = userId => usedOn(userId, today());

// The daily AI allowance is shared by the mentor, AI Maker and Site Maker. Spends `cost`
// messages if they're left and returns { ok, limit, remaining }, where remaining is the
// free messages left afterwards.
//
// A caller that names its `tool` (shown in the orb history) also lets people who turned
// on "When my free AI messages run out, use orbs" pay for what the free messages don't
// cover, at ORBS_PER_AI_UNIT orbs a message. The orbs come out in the same write
// transaction that checks the balance, like any other orb purchase, so parallel
// requests can't overdraw. tutor_usage only counts free messages, so code that gives a
// free message back by hand stays right for callers that don't name a tool.
//
// On success the result also has orbsSpent, refund() to give everything back when the
// AI doesn't deliver, and receipt: the same thing as plain data for refundAiSpend(),
// for a refund that happens later or in another process.
// When it can't, reason is "allowance" (free messages used up; orbCost is what the
// setting would cost) or "orbs" (setting on but too few; balance is what they have).
export function spendAllowance(userId, cost = 1, { tool = null } = {}) {
  const day = today();
  return transaction(() => {
    const limit = dailyLimit(userId);
    const remaining = Math.max(0, limit - usedOn(userId, day));
    const free = Math.min(cost, remaining);
    const paid = cost - free;
    const orbCost = paid * ORBS_PER_AI_UNIT;
    if (paid) {
      if (!tool || !aiOrbsOn(userId)) return { ok: false, reason: "allowance", limit, remaining, orbCost };
      const balance = walletBalance(userId);
      if (balance < orbCost) return { ok: false, reason: "orbs", limit, remaining, orbCost, balance };
    }
    const ref = `ai:${randomUUID()}`;
    if (free) {
      db.prepare(`INSERT INTO tutor_usage (user_id, day, count) VALUES (?, ?, ?)
        ON CONFLICT(user_id, day) DO UPDATE SET count = count + ?`).run(userId, day, free, free);
    }
    if (paid) {
      addEntry({ userId, amount: -orbCost, kind: "ai", ref,
        note: `${tool}: ${paid} AI ${paid === 1 ? "message" : "messages"} after your free ones` });
    }
    const receipt = { userId, day, free, orbsSpent: orbCost, ref, tool };
    return { ok: true, limit, remaining: remaining - free, orbsSpent: orbCost, receipt, refund: () => refundAiSpend(receipt) };
  });
}

// Gives back what one spendAllowance took: the free messages to that day's allowance
// and the orbs to the balance. Safe to run twice; returns whether it gave anything back.
export function refundAiSpend({ userId, day, free = 0, orbsSpent = 0, ref, tool = null } = {}) {
  if (!ref) return false;
  return transaction(() => {
    // Deleted since (nothing to give back to), or already given back.
    if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(userId)) return false;
    if (!db.prepare("INSERT OR IGNORE INTO ai_refunds (ref, created_at) VALUES (?, ?)").run(ref, now()).changes) return false;
    db.prepare("DELETE FROM ai_refunds WHERE created_at < ?").run(new Date(Date.now() - 7 * 86400_000).toISOString());
    if (free) db.prepare("UPDATE tutor_usage SET count = MAX(0, count - ?) WHERE user_id = ? AND day = ?").run(free, userId, day);
    if (orbsSpent) addEntry({ userId, amount: orbsSpent, kind: "ai_refund", ref: `${ref}:back`, note: `${tool ?? "AI"}: orbs back, the AI couldn't finish` });
    return true;
  });
}

// The answer when spendAllowance said no: 429 while the free messages are used up (with
// how to keep going on orbs), or 402 when the setting is on but there aren't enough orbs.
export function outOfAi(spent, message) {
  if (spent.reason === "orbs") {
    return { status: 402, error: `Your free AI messages are used up for today. This needs ${orbs(spent.orbCost)} and you have ${orbs(Math.max(0, spent.balance))}. Buy more orbs at /orbs, or wait for your free messages to come back at midnight UTC.` };
  }
  return { status: 429, error: `${message} To keep going now, turn on "When my free AI messages run out, use orbs" in the Orbs section of your account. This would cost ${orbs(spent.orbCost)}.` };
}

export const tutorRouter = express.Router();

// Public, for the orbs page: the free messages a day and what extra ones cost.
tutorRouter.get("/limits", (_req, res) => {
  res.json({ freeDaily: FREE_DAILY, aiPlanDaily: AI_PLAN_DAILY, orbsPerAiUnit: ORBS_PER_AI_UNIT });
});

tutorRouter.get("/usage", requireUser, (req, res) => {
  const limit = dailyLimit(req.user.id);
  // Only free messages are counted; ones paid with orbs aren't. Min, in case the limit
  // went down since (the AI plan was refunded).
  res.json({ used: Math.min(limit, usedToday(req.user.id)), limit, aiOrbs: aiOrbsOn(req.user.id), orbsPerAiUnit: ORBS_PER_AI_UNIT });
});

tutorRouter.post("/", requireUser, rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  if (!ai()) return res.status(503).json({ error: "Forge isn't set up yet." });
  const messages = (Array.isArray(req.body?.messages) ? req.body.messages : []).slice(-20)
    .filter(m => ["user", "assistant"].includes(m?.role) && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length) return res.status(400).json({ error: "Ask a question first." });

  const spent = spendAllowance(req.user.id, 1, { tool: "Forge mentor" });
  if (!spent.ok) {
    const out = outOfAi(spent, `You've used all ${spent.limit} messages for today. Forge resets at midnight UTC.`);
    return res.status(out.status).json({ error: out.error });
  }

  try {
    const r = await ai().messages.create({
      model: process.env.AI_MODEL || "claude-sonnet-5-5", max_tokens: 1500,
      system: isAdult(req.user) ? SYSTEM : SYSTEM + TEEN_NOTE, messages,
    });
    res.json({
      reply: r.content.filter(b => b.type === "text").map(b => b.text).join(""),
      remaining: spent.remaining, orbsSpent: spent.orbsSpent,
    });
  } catch (e) {
    // No answer, so the message (and any orbs it took) goes back.
    spent.refund();
    console.error("Tutor failed", e.message);
    res.status(502).json({ error: "Forge couldn't answer right now. Nothing was used, so try again in a moment." });
  }
});
