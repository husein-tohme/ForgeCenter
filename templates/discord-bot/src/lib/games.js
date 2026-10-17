// Small game rules: 8ball, coin flip, dice and rock-paper-scissors.
// Every function takes an optional rng (returns 0..1) so tests can make it predictable.

export function pick(list, rng = Math.random) {
  return list[Math.floor(rng() * list.length)];
}

export const EIGHT_BALL_ANSWERS = [
  "It is certain.", "It is decidedly so.", "Without a doubt.", "Yes, definitely.",
  "You may rely on it.", "As I see it, yes.", "Most likely.", "Outlook good.",
  "Yes.", "Signs point to yes.", "Reply hazy, try again.", "Ask again later.",
  "Better not tell you now.", "Cannot predict now.", "Concentrate and ask again.",
  "Don't count on it.", "My reply is no.", "My sources say no.", "Outlook not so good.",
  "Very doubtful.",
];

export const eightBall = (rng) => pick(EIGHT_BALL_ANSWERS, rng);
export const coinFlip = (rng = Math.random) => (rng() < 0.5 ? "Heads" : "Tails");

export const DICE_LIMITS = { maxCount: 100, maxSides: 1000, maxModifier: 1000 };

/** "2d6+3" -> { count: 2, sides: 6, modifier: 3 }. Returns null for anything invalid. */
export function parseDice(input) {
  const match = /^(\d*)d(\d+)([+-]\d+)?$/i.exec(String(input ?? "").replace(/\s+/g, ""));
  if (!match) return null;
  const count = match[1] ? Number(match[1]) : 1;
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[3]) : 0;
  if (count < 1 || count > DICE_LIMITS.maxCount) return null;
  if (sides < 2 || sides > DICE_LIMITS.maxSides) return null;
  if (Math.abs(modifier) > DICE_LIMITS.maxModifier) return null;
  return { count, sides, modifier };
}

/** Rolls parsed dice. Returns { rolls: [..], total }. */
export function rollDice({ count, sides, modifier }, rng = Math.random) {
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(rng() * sides));
  return { rolls, total: rolls.reduce((sum, n) => sum + n, 0) + modifier };
}

export const RPS_CHOICES = {
  rock: { emoji: "🪨", beats: "scissors" },
  paper: { emoji: "📄", beats: "rock" },
  scissors: { emoji: "✂️", beats: "paper" },
};

/** "win", "lose" or "draw" from the player's point of view. */
export function rpsOutcome(player, bot) {
  if (!RPS_CHOICES[player] || !RPS_CHOICES[bot]) throw new Error(`Unknown choice: ${player} / ${bot}`);
  if (player === bot) return "draw";
  return RPS_CHOICES[player].beats === bot ? "win" : "lose";
}
