// Builds the /help text from the command definitions, so it never goes out of date.
import { ApplicationCommandOptionType } from "discord.js";

export const CATEGORY_ORDER = [
  "Setup (admins)", "Tickets", "Roles", "Moderation (staff)", "Fun", "Games & coins", "Utility",
];

/** Returns [{ category, lines: ["`/ping` Check that I'm awake", ...] }] in a sensible order. */
export function helpSections(commands) {
  const sections = new Map();
  for (const command of commands) {
    const json = command.data.toJSON();
    const subcommands = (json.options ?? []).filter((o) => o.type === ApplicationCommandOptionType.Subcommand);
    const lines = subcommands.length
      ? subcommands.map((s) => `\`/${json.name} ${s.name}\` ${s.description}`)
      : [`\`/${json.name}\` ${json.description}`];
    const category = command.category ?? "Other";
    sections.set(category, [...(sections.get(category) ?? []), ...lines]);
  }
  const rank = (category) => {
    const i = CATEGORY_ORDER.indexOf(category);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  return [...sections.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([category, lines]) => ({ category, lines }));
}
