// Forge, the AI coding mentor. Signed-in users get a daily message allowance.
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { db, addColumn, walletBalance } from "./db.js";
import { requireUser } from "./auth.js";
import { rateLimit } from "./limit.js";
import { paidOrderCount } from "./orders.js";
import { orbs } from "./catalog.js";
import { addEntry, transaction } from "./wallet.js";

export const FREE_DAILY = 30;
export const AI_PLAN_DAILY = 300;

const SYSTEM = `You are Forge, the ForgeCenter coding mentor. Your goal is to turn the learner into a professional developer.
Teach step by step, find out what they already know, give small exercises, review their code honestly, and explain the "why".
You also help plan Minecraft mods, Discord bots, websites and games. Many learners are young, so keep explanations clear and kind.`;
// Accounts are in the teen group until an adult confirms their age (see age.js).
const TEEN_NOTE = "\n\nThis learner's account is in the teen age group. Keep every example, project idea and topic suitable for teenagers.";

let client;
const ai = () => (process.env.ANTHROPIC_API_KEY ? (client ??= new Anthropic()) : null);
const today = () => new Date().toISOString().slice(0, 10);
export const dailyLimit = userId => (paidOrderCount(userId, "ai") > 0 ? AI_PLAN_DAILY : FREE_DAILY);
const usedToday = userId =>
  db.prepare("SELECT count FROM tutor_usage WHERE user_id = ? AND day = ?").get(userId, today())?.count ?? 0;

// Orbs per allowance unit once the free messages are used up, for people who turned on
// "When my free AI messages run out, use orbs" (users.ai_orbs, set from the account page).
export const ORBS_PER_AI_UNIT = Math.max(1, Number.parseInt(process.env.AI_ORBS_PER_UNIT, 10) || 5);
addColumn("users", "ai_orbs", "INTEGER DEFAULT 0");
export const aiOrbsOn = userId => !!db.prepare("SELECT ai_orbs FROM users WHERE id = ?").get(userId)?.ai_orbs;

// The daily AI allowance is shared by the mentor, AI Maker and Site Maker. Spends `cost`
// messages: free ones first, then orbs for the rest if the person allows it. Returns
// whether it could, what's left of the free messages afterwards, the orbs it took, and
// refund() to give all of it back when the AI call doesn't deliver.
//
// tutor_usage counts every unit used today, free or paid, so a unit past the limit is
// one paid for with orbs. The orbs come out in the same write transaction that checks
// the balance, like any other orb purchase.
export function spendAllowance(userId, cost = 1, { tool = "AI tools" } = {}) {
  const day = today();
  return transaction(() => {
    const limit = dailyLimit(userId);
    const used = usedToday(userId);
    const free = Math.max(0, Math.min(cost, limit - used));
    const paidUnits = cost - free;
    const orbCost = paidUnits * ORBS_PER_AI_UNIT;
    const remaining = Math.max(0, limit - used);
    let ref = null;
    if (paidUnits) {
      if (!aiOrbsOn(userId)) return { ok: false, reason: "allowance", limit, remaining, orbCost, orbsSpent: 0 };
      const balance = walletBalance(userId);
      if (balance < orbCost) return { ok: false, reason: "orbs", limit, remaining, orbCost, balance, orbsSpent: 0 };
      ref = `ai:${randomUUID()}`;
      addEntry({ userId, amount: -orbCost, kind: "ai", ref,
        note: `${tool}: ${paidUnits} AI ${paidUnits === 1 ? "message" : "messages"} past the free allowance` });
    }
    db.prepare(`INSERT INTO tutor_usage (user_id, day, count) VALUES (?, ?, ?)
      ON CONFLICT(user_id, day) DO UPDATE SET count = count + ?`).run(userId, day, cost, cost);
    let refunded = false;
    const refund = () => {
      if (refunded) return;
      refunded = true;
      transaction(() => {
        db.prepare("UPDATE tutor_usage SET count = MAX(0, count - ?) WHERE user_id = ? AND day = ?").run(cost, userId, day);
        if (ref) addEntry({ userId, amount: orbCost, kind: "ai", ref: `${ref}:refund`, note: `${tool}: orbs back, the AI couldn't finish` });
      });
    };
    return { ok: true, limit, remaining: Math.max(0, limit - used - cost), orbsSpent: orbCost, refund };
  });
}

// The answer when spendAllowance said no: 429 while the free messages are used up (with
// how to keep going on orbs), or 402 when orbs are on but there aren't enough.
export function outOfAi(spent, message) {
  if (spent.reason === "orbs") {
    return { status: 402, error: `Your free AI messages are used up for today, and this needs ${orbs(spent.orbCost)} but you have ${orbs(Math.max(0, spent.balance))}. Buy more orbs at /orbs, or wait for your free messages to come back at midnight UTC.` };
  }
  return { status: 429, error: `${message} Or turn on "When my free AI messages run out, use orbs" in the Orbs section of your account to keep going: this would cost ${orbs(spent.orbCost)}.` };
}

export const tutorRouter = express.Router();

tutorRouter.get("/usage", requireUser, (req, res) => {
  const limit = dailyLimit(req.user.id);
  // Units past the limit were paid with orbs, so "used" stops at the limit.
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
      system: req.user.age_group === "adult" ? SYSTEM : SYSTEM + TEEN_NOTE, messages,
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
