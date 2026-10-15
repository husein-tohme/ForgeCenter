import express from "express";
import helmet from "helmet";
import { catalog } from "./catalog.js";
import { authRouter, meRouter, loadUser } from "./auth.js";
import { ordersRouter, adminOrdersRouter, stripeWebhook } from "./orders.js";
import { showcaseRouter, adminShowcaseRouter } from "./showcase.js";
import { tutorRouter } from "./tutor.js";
import { toolsRouter } from "./tools.js";
import { oauthRouter, enabledOAuthProviders } from "./oauth.js";
import { whatsappRouter, whatsappEnabled } from "./whatsapp.js";
import { servicesRouter, adminServicesRouter } from "./services.js";
import { pagesRouter, notFound } from "./pages.js";

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
        imgSrc: ["'self'", "data:", "blob:", "https://*.googleusercontent.com", "https://avatars.githubusercontent.com", "https://cdn.discordapp.com", "https://cdn.modrinth.com"],
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
    signIn: [
      ...(process.env.GOOGLE_CLIENT_ID ? ["google"] : []),
      ...enabledOAuthProviders(),
      ...(whatsappEnabled() ? ["whatsapp"] : []),
    ],
    contactEmail: process.env.CONTACT_EMAIL || null,
  }));
  app.get("/api/catalog", (_req, res) => res.json(catalog));

  app.use("/api/auth", authRouter);
  app.use("/api/auth/whatsapp", whatsappRouter);
  app.use("/api/auth", oauthRouter);
  app.use("/api/me", meRouter);
  app.use("/api", ordersRouter);
  app.use("/api/admin", adminOrdersRouter, adminShowcaseRouter, adminServicesRouter);
  app.use("/api/services", servicesRouter);
  app.use("/api/showcase", showcaseRouter);
  app.use("/api/tutor", tutorRouter);

  app.use("/api", toolsRouter);

  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
  app.use(pagesRouter);
  app.use(express.static("public", { index: false }));
  app.use(notFound);

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.expose ? err.message : "Something went wrong." });
  });
  return app;
}
