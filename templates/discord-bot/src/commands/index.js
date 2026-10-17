// The list of all slash commands. To add a command: create a file in this folder that
// default-exports { category, data, execute, components? }, then add it below.
import setup from "./setup.js";
import ticket from "./ticket.js";
import roles from "./roles.js";
import warn from "./warn.js";
import warnings from "./warnings.js";
import timeout from "./timeout.js";
import kick from "./kick.js";
import ban from "./ban.js";
import purge from "./purge.js";
import meme from "./meme.js";
import eightball from "./eightball.js";
import coinflip from "./coinflip.js";
import roll from "./roll.js";
import trivia from "./trivia.js";
import rps from "./rps.js";
import daily from "./daily.js";
import balance from "./balance.js";
import leaderboard from "./leaderboard.js";
import help from "./help.js";
import serverinfo from "./serverinfo.js";
import userinfo from "./userinfo.js";
import ping from "./ping.js";

export const commands = [
  setup, ticket, roles,
  warn, warnings, timeout, kick, ban, purge,
  meme, eightball, coinflip, roll,
  trivia, rps, daily, balance, leaderboard,
  help, serverinfo, userinfo, ping,
];

/**
 * Builds lookup maps: command name -> command, and button/menu customId prefix -> handler.
 * Throws if two commands share a name or a prefix, so mistakes show up at startup (and in tests).
 */
export function buildRegistry(list = commands) {
  const byName = new Map();
  const components = new Map();
  for (const command of list) {
    const { name } = command.data;
    if (byName.has(name)) throw new Error(`Two commands are named /${name}`);
    byName.set(name, command);
    for (const [prefix, handler] of Object.entries(command.components ?? {})) {
      if (components.has(prefix)) throw new Error(`Two commands handle the "${prefix}:" button prefix`);
      components.set(prefix, handler);
    }
  }
  return { byName, components };
}

/** The JSON Discord needs to register the commands. */
export const commandsJson = (list = commands) => list.map((command) => command.data.toJSON());
