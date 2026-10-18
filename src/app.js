import express from "express";
import helmet from "helmet";
import { publicCatalog } from "./catalog.js";
import { authRouter, meRouter, loadUser } from "./auth.js";
import { ordersRouter, adminOrdersRouter } from "./orders.js";
import { stripeWebhook } from "./webhooks.js";
import { ageRouter } from "./age.js";
import { walletRouter, adminWalletRouter } from "./wallet.js";
import { supportRouter, adminSupportRouter } from "./support.js";
import { showcaseRouter, adminShowcaseRouter } from "./showcase.js";
import { tutorRouter } from "./tutor.js";
import { assistantsRouter, adminAssistantsRouter } from "./aimaker.js";
import { sitesRouter } from "./sitemaker.js";
import { reportsRouter, adminReportsRouter } from "./reports.js";
import { toolsRouter } from "./tools.js";
import { developerRouter, developerApi, developerApiErrors } from "./developer.js";
import { robloxRouter } from "./roblox.js";
import { oauthRouter, enabledOAuthProviders } from "./oauth.js";
import { whatsappRouter, whatsappEnabled } from "./whatsapp.js";
import { setupRouter, githubDone } from "./setup.js";
import { emailRouter } from "./email.js";
import { servicesRouter, adminServicesRouter } from "./services.js";
import { gamesRouter, adminGamesRouter } from "./launchpad.js";
import { creatorsRouter, adminCreatorsRouter } from "./creators.js";
import { pagesRouter, notFound } from "./pages.js";
import { donationsRouter, keepMonthlyDonors } from "./donations.js";
import { payoutsRouter } from "./payouts.js";
import { githubRouter } from "./github-repos.js";

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
        // GitHub: one-click sign-in setup posts the app manifest there (src/setup.js).
        formAction: ["'self'", "https://github.com/settings/apps/new"],
        upgradeInsecureRequests: isProd ? [] : null,
      },
    },
    // Google's sign-in popup needs these two relaxed from helmet's defaults.
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }));

  // Stripe needs the raw body to verify signatures, so this comes before express.json().
  app.post("/api/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), stripeWebhook);

  // Unsubscribe links come from mail apps as plain form posts, so they skip the JSON guard below.
  app.use("/api/email", emailRouter);

  app.use(express.json({ limit: "100kb" }));
  // The developer API signs in only with an API key, so it comes before loadUser: a
  // session cookie can never authorize it, and it doesn't need the CSRF guard below.
  app.use("/v1", developerApi, developerApiErrors);
  app.use(loadUser);

  // Basic CSRF protection: state-changing API calls must be same-origin JSON. The site's
  // own BASE_URL also counts, for hosts whose proxy passes a different Host header
  // (such as GitHub Codespaces).
  const siteHost = (() => { try { return new URL(process.env.BASE_URL).host; } catch { return null; } })();
  app.use("/api", (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.get("origin");
    let sameOrigin = true;
    if (origin) {
      try { const host = new URL(origin).host; sameOrigin = host === req.get("host") || host === siteHost; }
      catch { sameOrigin = false; }
    }
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
  app.get("/api/catalog", (_req, res) => res.json(publicCatalog()));

  app.use("/api/auth", authRouter);
  app.use("/api/auth/whatsapp", whatsappRouter);
  app.use("/api/auth", oauthRouter);
  app.use("/api/setup", setupRouter);
  app.get("/setup-signin/github/done", githubDone);
  // A monthly donor cancels before deleting their account, or they couldn't stop it later.
  app.delete("/api/me", keepMonthlyDonors);
  app.use("/api/me", meRouter);
  app.use("/api", ordersRouter);
  app.use("/api/admin", adminOrdersRouter, adminShowcaseRouter, adminServicesRouter, adminWalletRouter, adminSupportRouter, adminGamesRouter, adminCreatorsRouter, adminAssistantsRouter, adminReportsRouter);
  app.use("/api/age", ageRouter);
  app.use("/api/wallet", walletRouter);
  app.use("/api/support", supportRouter);
  app.use("/api/services", servicesRouter);
  app.use("/api/showcase", showcaseRouter);
  app.use("/api/tutor", tutorRouter);
  app.use("/api/games", gamesRouter);
  app.use("/api/donations", donationsRouter);
  app.use("/api/payouts", payoutsRouter);
  app.use("/api/developer", developerRouter);
  app.use("/api/creators", githubRouter, creatorsRouter);
  app.use("/api/roblox", robloxRouter);
  app.use("/api/assistants", assistantsRouter);
  app.use("/api/sites", sitesRouter);
  app.use("/api/reports", reportsRouter);

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
