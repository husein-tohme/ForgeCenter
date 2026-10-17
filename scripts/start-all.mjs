// Runs the website and the bot runner together, for hosts where both must share one
// disk (Render attaches a disk to a single service). `npm run start:all`.
import { spawn } from "node:child_process";

// Render gives every service its public address; use it unless BASE_URL is set.
if (!process.env.BASE_URL && process.env.RENDER_EXTERNAL_URL) process.env.BASE_URL = process.env.RENDER_EXTERNAL_URL;

const node = (script) => spawn(process.execPath, ["--disable-warning=ExperimentalWarning", script], { stdio: "inherit", env: process.env });

const children = [node("src/server.js")];
// Customer bots need SECRET_KEY to decrypt their tokens; without it, run the website only.
if ((process.env.SECRET_KEY ?? "").length >= 32) children.push(node("src/bots.js"));
else console.log("SECRET_KEY isn't set, so customer Discord bots won't run. The website runs as normal.");

let stopping = false;
const stopAll = (code) => {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 10_000).unref();
};
// If the website stops, stop everything so the host restarts the service. The bot
// runner stopping on its own (e.g. bot packages missing) doesn't take the site down.
children[0].on("exit", code => stopAll(code ?? 1));
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => stopAll(0));
process.on("exit", () => { for (const c of children) if (c.exitCode === null) c.kill("SIGTERM"); });
