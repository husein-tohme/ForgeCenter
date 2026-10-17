// Sign in with a phone number: a 6-digit code is sent through the official
// WhatsApp Business Cloud API using an approved "authentication" template.
import express from "express";
import { randomInt, timingSafeEqual } from "node:crypto";
import { db } from "./db.js";
import { hash, publicUser, signInWith, startSession, LinkError } from "./auth.js";
import { rateLimit } from "./limit.js";

const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const PER_PHONE_PER_HOUR = 3;
const PER_IP_PER_HOUR = 10;
const dailyLimit = () => Number(process.env.WHATSAPP_DAILY_LIMIT) || 300;

export const whatsappEnabled = () =>
  !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TEMPLATE);

// "+44 7700 900123" -> "447700900123". Returns null if it isn't a plausible international number.
export function normalizePhone(input) {
  const raw = String(input ?? "").trim();
  if (!raw.startsWith("+")) return null;
  const digits = raw.replace(/[\s().-]/g, "").slice(1);
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

async function cloudApi({ to, code }) {
  const version = process.env.WHATSAPP_API_VERSION || "v23.0";
  const r = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to, type: "template",
      template: {
        name: process.env.WHATSAPP_TEMPLATE,
        language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en_US" },
        components: [
          { type: "body", parameters: [{ type: "text", text: code }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
        ],
      },
    }),
  });
  if (!r.ok) throw new Error(`WhatsApp API ${r.status}: ${await r.text().catch(() => "")}`);
}

let transport = cloudApi;
export const setWhatsAppTransport = fn => { transport = fn; };

const codeHash = (phone, code) => hash(`${phone}:${code}`);

export const whatsappRouter = express.Router();

whatsappRouter.post("/start", rateLimit({ windowMs: 60_000, max: 5 }), async (req, res) => {
  if (!whatsappEnabled()) return res.status(503).json({ error: "WhatsApp sign-in isn't set up yet." });
  const phone = normalizePhone(req.body?.phone);
  if (!phone) return res.status(400).json({ error: "Enter your number with the country code, like +44 7700 900123." });

  const hourAgo = Date.now() - 60 * 60_000;
  db.prepare("DELETE FROM whatsapp_sends WHERE sent_at < ?").run(Date.now() - 24 * 60 * 60_000);
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;
  if (count("SELECT COUNT(*) AS n FROM whatsapp_sends WHERE phone = ? AND sent_at > ?", phone, hourAgo) >= PER_PHONE_PER_HOUR
    || count("SELECT COUNT(*) AS n FROM whatsapp_sends WHERE ip = ? AND sent_at > ?", req.ip, hourAgo) >= PER_IP_PER_HOUR) {
    return res.status(429).json({ error: "Too many codes requested. Wait an hour and try again." });
  }
  if (count("SELECT COUNT(*) AS n FROM whatsapp_sends") >= dailyLimit()) {
    return res.status(429).json({ error: "WhatsApp sign-in is busy right now. Try another sign-in option." });
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  try { await transport({ to: phone, code }); }
  catch (e) {
    console.error("WhatsApp send failed", e.message);
    return res.status(502).json({ error: "The code couldn't be sent. Check the number is on WhatsApp and try again." });
  }
  db.prepare(`INSERT INTO whatsapp_codes (phone, code_hash, attempts, expires_at) VALUES (?, ?, 0, ?)
    ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at`)
    .run(phone, codeHash(phone, code), Date.now() + CODE_TTL_MS);
  db.prepare("INSERT INTO whatsapp_sends (phone, ip, sent_at) VALUES (?, ?, ?)").run(phone, req.ip, Date.now());
  res.json({ ok: true });
});

whatsappRouter.post("/verify", rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const code = String(req.body?.code ?? "").replace(/\s/g, "");
  if (!phone || !/^\d{6}$/.test(code)) return res.status(400).json({ error: "Enter the 6-digit code from WhatsApp." });

  const row = db.prepare("SELECT * FROM whatsapp_codes WHERE phone = ?").get(phone);
  if (!row || row.expires_at < Date.now()) return res.status(400).json({ error: "That code has expired. Send a new one." });
  if (row.attempts >= MAX_ATTEMPTS) {
    db.prepare("DELETE FROM whatsapp_codes WHERE phone = ?").run(phone);
    return res.status(429).json({ error: "Too many wrong codes. Send a new one." });
  }
  const ok = timingSafeEqual(Buffer.from(codeHash(phone, code)), Buffer.from(row.code_hash));
  if (!ok) {
    db.prepare("UPDATE whatsapp_codes SET attempts = attempts + 1 WHERE phone = ?").run(phone);
    return res.status(400).json({ error: "That code isn't right. Check WhatsApp and try again." });
  }
  db.prepare("DELETE FROM whatsapp_codes WHERE phone = ?").run(phone);

  let user;
  try {
    user = signInWith({ provider: "whatsapp", subject: phone, phone: `+${phone}`,
      name: `Player ${phone.slice(-4)}`, display: `+${phone}` }, req.body?.link ? req.user?.id : null);
  } catch (e) {
    if (e instanceof LinkError) return res.status(409).json({ error: e.message });
    throw e;
  }
  startSession(res, user.id);
  res.json({ user: publicUser(user) });
});
