import { createApp } from "./app.js";
import { db } from "./db.js";

const port = process.env.PORT || 3000;
createApp().listen(port, () => console.log(`ForgeCenter running on ${process.env.BASE_URL || `http://localhost:${port}`}`));

// Remove expired sign-ins once a day.
const cleanSessions = () => db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
cleanSessions();
setInterval(cleanSessions, 24 * 60 * 60 * 1000).unref();
