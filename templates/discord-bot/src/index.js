// Entry point: `npm start`
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`This bot needs Node.js 22.13 or newer, but this computer has ${process.versions.node}. See README.md.`);
  process.exit(1);
}

// Loaded after the version check because older Node versions don't have node:sqlite.
import("./bot.js")
  .then(({ start }) => start())
  .catch((error) => {
    console.error("[startup] The bot could not start:", error);
    process.exit(1);
  });
