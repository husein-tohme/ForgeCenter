import express from "express";
import Stripe from "stripe";
import Anthropic from "@anthropic-ai/sdk";
import { catalog } from "./catalog.js";
import { modFiles, streamZip, createModrinthProject } from "./modgen.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const ai = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
const port = process.env.PORT || 3000;
const BASE = process.env.BASE_URL || `http://localhost:${port}`;

app.get("/api/catalog", (_req, res) => res.json(catalog));

app.post("/api/checkout", async (req, res) => {
  const item = catalog[req.body?.product];
  if (!item) return res.status(400).json({ error: "Unknown product" });
  if (!stripe) return res.status(503).json({ error: "Payments not configured yet (set STRIPE_SECRET_KEY)" });
  try {
    const session = await stripe.checkout.sessions.create({
      mode: item.mode,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd", unit_amount: item.price,
          product_data: { name: item.name, description: item.desc },
          ...(item.mode === "subscription" ? { recurring: { interval: "month" } } : {}),
        },
      }],
      success_url: `${BASE}/?paid=1`,
      cancel_url: `${BASE}/#pricing`,
    });
    res.json({ url: session.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/mod/zip", (req, res) => {
  const { name, author, description } = req.body || {};
  if (!name || !author || !description) return res.status(400).json({ error: "name, author and description are required" });
  streamZip(modFiles(req.body), res, String(name).replace(/\W+/g, "-"));
});

app.post("/api/mod/modrinth", async (req, res) => {
  const { token, name, description, license = "MIT" } = req.body || {};
  if (!token || !name || !description) return res.status(400).json({ error: "token, name and description are required" });
  try { res.json(await createModrinthProject({ token, name, description, license })); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

const TUTOR = `You are Forge, the ForgeCenter coding mentor. Your goal is to turn the learner into a professional developer.
Teach step by step, find out what they already know, give small exercises, review their code honestly, and explain the "why".
You also help plan Minecraft mods, Discord bots, websites and games.`;

app.post("/api/tutor", async (req, res) => {
  if (!ai) return res.status(503).json({ error: "AI not configured yet (set ANTHROPIC_API_KEY)" });
  const messages = (req.body?.messages || []).slice(-20)
    .filter(m => ["user", "assistant"].includes(m.role) && typeof m.content === "string");
  if (!messages.length || messages[0].role !== "user") return res.status(400).json({ error: "messages required" });
  try {
    const r = await ai.messages.create({
      model: process.env.AI_MODEL || "claude-sonnet-5-5",
      max_tokens: 1500, system: TUTOR, messages,
    });
    res.json({ reply: r.content.filter(b => b.type === "text").map(b => b.text).join("") });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(port, () => console.log(`ForgeCenter running on ${BASE}`));
