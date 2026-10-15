// Trivia rules: picking a question, shuffling answers and checking a guess.
import { QUESTIONS } from "./triviaQuestions.js";

export const TRIVIA_TIME_LIMIT_MS = 20_000;

/** category: "minecraft", "general" or "any". */
export function pickQuestion(category = "any", rng = Math.random, questions = QUESTIONS) {
  const pool = category === "any" ? questions : questions.filter((q) => q.category === category);
  if (!pool.length) throw new Error(`No trivia questions in category "${category}"`);
  return pool[Math.floor(rng() * pool.length)];
}

/** Returns { question, category, options: [4 answers in random order], correctIndex }. */
export function prepareQuestion(q, rng = Math.random) {
  const options = [q.answer, ...q.wrong];
  // Fisher-Yates shuffle
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { question: q.question, category: q.category, options, correctIndex: options.indexOf(q.answer) };
}

/** True if the chosen button index is the right answer. */
export function checkAnswer(prepared, chosenIndex) {
  return Number.isInteger(chosenIndex) && chosenIndex === prepared.correctIndex;
}
