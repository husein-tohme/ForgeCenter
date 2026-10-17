import { createApp } from "./app.js";
import { db } from "./db.js";
import { startServiceWorker } from "./services.js";
import { enabledOAuthProviders } from "./oauth.js";
import { whatsappEnabled } from "./whatsapp.js";
import { announceSetupCode } from "./setup.js";

const port = process.env.PORT || 3000;
createApp().listen(port, () => console.log(`ForgeCenter running on ${process.env.BASE_URL || `http://localhost:${port}`}`));

// While nobody can sign in yet, print a code that unlocks /setup-signin.
announceSetupCode(enabledOAuthProviders().length > 0 || !!process.env.GOOGLE_CLIENT_ID || whatsappEnabled());

// Sets up, suspends and removes Minecraft servers as orders change.
startServiceWorker();

// Remove expired sign-ins once a day.
const cleanSessions = () => db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
cleanSessions();
setInterval(cleanSessions, 24 * 60 * 60 * 1000).unref();
