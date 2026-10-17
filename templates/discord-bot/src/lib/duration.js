// Turning "10m" into milliseconds and milliseconds into "5h 12m".

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Discord's longest allowed timeout. */
export const MAX_TIMEOUT_MS = 28 * DAY;

// Longest spellings first so "minutes" is not read as "m" + "inutes".
const UNIT_PATTERN =
  /(\d+)(weeks|week|wks|wk|w|days|day|d|hours|hour|hrs|hr|h|minutes|minute|mins|min|m|seconds|second|secs|sec|s)/gy;

function unitToMs(unit) {
  if (unit.startsWith("w")) return WEEK;
  if (unit.startsWith("d")) return DAY;
  if (unit.startsWith("h")) return HOUR;
  if (unit.startsWith("m")) return MINUTE;
  return SECOND;
}

/** "10m" -> 600000, "1h30m" -> 5400000, "2 days" -> 172800000. Returns null if it can't be read. */
export function parseDuration(input) {
  const text = String(input ?? "").toLowerCase().replace(/\s+/g, "");
  if (!text) return null;
  UNIT_PATTERN.lastIndex = 0;
  let total = 0;
  let match;
  while ((match = UNIT_PATTERN.exec(text))) {
    total += Number(match[1]) * unitToMs(match[2]);
    if (UNIT_PATTERN.lastIndex === text.length) return total > 0 ? total : null;
  }
  return null; // leftover characters that are not a number + unit
}

/** 18720000 -> "5h 12m". Shows the two largest units. */
export function formatDuration(ms) {
  const parts = [];
  let rest = Math.max(0, Math.round(ms / SECOND)) * SECOND;
  for (const [size, label] of [
    [DAY, "d"],
    [HOUR, "h"],
    [MINUTE, "m"],
    [SECOND, "s"],
  ]) {
    const amount = Math.floor(rest / size);
    if (amount > 0) parts.push(`${amount}${label}`);
    rest -= amount * size;
  }
  return parts.slice(0, 2).join(" ") || "0s";
}
