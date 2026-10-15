// Fills placeholders like {user} and {server} in admin-written messages.

/**
 * renderTemplate("Hi {user}, welcome to {server}!", { user: "<@1>", server: "Forge" })
 * - Placeholder names are case-insensitive ({Server} works too).
 * - Unknown placeholders are left as they are, so typos are easy to spot.
 * - A typed "\n" becomes a real line break (slash command text boxes can't contain newlines).
 */
export function renderTemplate(template, values) {
  const lookup = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return String(template)
    .replace(/\\n/g, "\n")
    .replace(/\{(\w+)\}/g, (match, key) => lookup.get(key.toLowerCase()) ?? match);
}
