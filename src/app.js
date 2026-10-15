import express from "express";
import helmet from "helmet";
import { db, now } from "./db.js";
import { catalog } from "./catalog.js";
import { modFiles, streamZip, createModrinthProject } from "./modgen.js";
import { authRouter, meRouter, loadUser, requireUser } from "./auth.js";
import { ordersRouter, adminOrdersRouter, stripeWebhook } from "./orders.js";
import { showcaseRouter, adminShowcaseRouter } from "./showcase.js";
import { tutorRouter } from "./tutor.js";
import { rateLimit } from "./limit.js";

export function createApp() {
  const app = express();
  const isProd = process.env.NODE_ENV === "production";
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://accounts.google.com/gsi/client"],
        frameSrc: ["https://accounts.google.com/gsi/"],
        connectSrc: ["'self'", "https://accounts.google.com/gsi/"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://accounts.google.com/gsi/style"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https://*.googleusercontent.com"],
        formAction: ["'self'"],
        upgradeInsecureRequests: isProd ? [] : null,
      },
    },
    // Google's sign-in popup needs these two relaxed from helmet's defaults.
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }));

  // Stripe needs the raw body to verify signatures, so this comes before express.json().
  app.post("/api/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), stripeWebhook);

  app.use(express.json({ limit: "100kb" }));
  app.use(loadUser);

  // Basic CSRF protection: state-changing API calls must be same-origin JSON.
  app.use("/api", (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.get("origin");
    let sameOrigin = true;
    if (origin) { try { sameOrigin = new URL(origin).host === req.get("host"); } catch { sameOrigin = false; } }
    if (!sameOrigin) return res.status(403).json({ error: "Cross-site request blocked." });
    if (!req.is("application/json")) return res.status(415).json({ error: "Send requests as JSON." });
    next();
  });

  app.get("/api/config", (_req, res) => res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    contactEmail: process.env.CONTACT_EMAIL || null,
  }));
  app.get("/api/catalog", (_req, res) => res.json(catalog));

  app.use("/api/auth", authRouter);
  app.use("/api/me", meRouter);
  app.use("/api", ordersRouter);
  app.use("/api/admin", adminOrdersRouter, adminShowcaseRouter);
  app.use("/api/showcase", showcaseRouter);
  app.use("/api/tutor", tutorRouter);

  // Mod Forge works without an account; signed-in users get their mods saved.
  const recordMod = (req, modrinthUrl = null) => {
    if (req.user) db.prepare("INSERT INTO mods (user_id, name, modrinth_url, created_at) VALUES (?, ?, ?, ?)")
      .run(req.user.id, String(req.body.name).slice(0, 60), modrinthUrl, now());
  };

  app.post("/api/mod/zip", rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
    const { name, author, description } = req.body || {};
    if (!name || !author || !description) return res.status(400).json({ error: "Add a mod name, your name and what it adds." });
    recordMod(req);
    streamZip(modFiles(req.body), res, String(name).replace(/\W+/g, "-"));
  });

  app.post("/api/mod/modrinth", rateLimit({ windowMs: 60_000, max: 5 }), async (req, res) => {
    const { token, name, description, license = "MIT" } = req.body || {};
    if (!token || !name || !description) return res.status(400).json({ error: "Add a Modrinth token, a mod name and what it adds." });
    try {
      const result = await createModrinthProject({ token, name, description, license });
      recordMod(req, result.url);
      res.json(result);
    } catch (e) { res.status(502).json({ error: e.message }); }
  });

  app.get("/api/mods", requireUser, (req, res) => {
    res.json({ mods: db.prepare("SELECT id, name, modrinth_url AS modrinthUrl, created_at AS createdAt FROM mods WHERE user_id = ? ORDER BY id DESC LIMIT 100").all(req.user.id) });
  });

  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
  app.use(express.static("public", { extensions: ["html"] }));

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.expose ? err.message : "Something went wrong." });
  });
  return app;
}
