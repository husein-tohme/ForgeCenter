// Forge, the AI coding mentor. Signed-in users get a daily message allowance.
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db.js";
import { requireUser } from "./auth.js";
import { rateLimit } from "./limit.js";
import { paidOrderCount } from "./orders.js";

export const FREE_DAILY = 30;
export const AI_PLAN_DAILY = 300;

const SYSTEM = `You are Forge, the ForgeCenter coding mentor. Your goal is to turn the learner into a professional developer.
Teach step by step, find out what they already know, give small exercises, review their code honestly, and explain the "why".
You also help plan Minecraft mods, Discord bots, websites and games. Many learners are young, so keep explanations clear and kind.`;

let client;
const ai = () => (process.env.ANTHROPIC_API_KEY ? (client ??= new Anthropic()) : null);
const today = () => new Date().toISOString().slice(0, 10);
const dailyLimit = userId => (paidOrderCount(userId, "ai") > 0 ? AI_PLAN_DAILY : FREE_DAILY);
const usedToday = userId =>
  db.prepare("SELECT count FROM tutor_usage WHERE user_id = ? AND day = ?").get(userId, today())?.count ?? 0;

export const tutorRouter = express.Router();

tutorRouter.get("/usage", requireUser, (req, res) => {
  const limit = dailyLimit(req.user.id);
  res.json({ used: usedToday(req.user.id), limit });
});

tutorRouter.post("/", requireUser, rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  if (!ai()) return res.status(503).json({ error: "Forge isn't set up yet." });
  const messages = (Array.isArray(req.body?.messages) ? req.body.messages : []).slice(-20)
    .filter(m => ["user", "assistant"].includes(m?.role) && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length) return res.status(400).json({ error: "Ask a question first." });

  const limit = dailyLimit(req.user.id);
  if (usedToday(req.user.id) >= limit) {
    return res.status(429).json({ error: `You've used all ${limit} messages for today. Forge resets at midnight UTC.` });
  }
  db.prepare(`INSERT INTO tutor_usage (user_id, day, count) VALUES (?, ?, 1)
    ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1`).run(req.user.id, today());

  try {
    const r = await ai().messages.create({
      model: process.env.AI_MODEL || "claude-sonnet-5-5", max_tokens: 1500, system: SYSTEM, messages,
    });
    res.json({
      reply: r.content.filter(b => b.type === "text").map(b => b.text).join(""),
      remaining: Math.max(0, limit - usedToday(req.user.id)),
    });
  } catch (e) {
    console.error("Tutor failed", e.message);
    res.status(502).json({ error: "Forge couldn't answer right now. Try again in a moment." });
  }
});
