import test from "node:test";
import assert from "node:assert/strict";
import { QUESTIONS } from "../src/lib/triviaQuestions.js";
import { checkAnswer, pickQuestion, prepareQuestion } from "../src/lib/trivia.js";

/** Predictable "random" numbers for tests. */
const sequence = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

test("the question bank is big enough and well formed", () => {
  assert.ok(QUESTIONS.length >= 30, `only ${QUESTIONS.length} questions`);
  assert.ok(QUESTIONS.filter((q) => q.category === "minecraft").length >= 10, "needs Minecraft questions");
  const seen = new Set();
  for (const q of QUESTIONS) {
    assert.ok(["minecraft", "general"].includes(q.category), q.question);
    assert.equal(q.wrong.length, 3, q.question);
    const all = [q.answer, ...q.wrong];
    assert.equal(new Set(all).size, 4, `duplicate answers in: ${q.question}`);
    for (const a of all) assert.ok(a.length > 0 && a.length <= 76, `answer too long for a button: ${a}`);
    assert.ok(!seen.has(q.question), `duplicate question: ${q.question}`);
    seen.add(q.question);
  }
});

test("prepareQuestion shuffles but keeps track of the right answer", () => {
  const q = { category: "general", question: "2+2?", answer: "4", wrong: ["3", "5", "22"] };
  for (const rng of [sequence(0), sequence(0.99), sequence(0.5, 0.1, 0.8), Math.random]) {
    const p = prepareQuestion(q, rng);
    assert.deepEqual([...p.options].sort(), ["22", "3", "4", "5"]);
    assert.equal(p.options[p.correctIndex], "4");
    assert.equal(p.question, "2+2?");
  }
});

test("shuffling actually moves the right answer around", () => {
  const q = { category: "general", question: "?", answer: "right", wrong: ["a", "b", "c"] };
  const positions = new Set();
  for (let i = 0; i < 200; i++) positions.add(prepareQuestion(q).correctIndex);
  assert.equal(positions.size, 4);
});

test("checkAnswer accepts only the right index", () => {
  const p = { options: ["a", "b", "c", "d"], correctIndex: 2 };
  assert.equal(checkAnswer(p, 2), true);
  assert.equal(checkAnswer(p, 0), false);
  assert.equal(checkAnswer(p, 3), false);
  assert.equal(checkAnswer(p, Number("not a number")), false);
  assert.equal(checkAnswer(p, "2"), false, "strings from customIds must be converted first");
});

test("pickQuestion respects the category", () => {
  for (let i = 0; i < 50; i++) {
    assert.equal(pickQuestion("minecraft").category, "minecraft");
    assert.equal(pickQuestion("general").category, "general");
  }
  assert.equal(pickQuestion("any", sequence(0)), QUESTIONS[0]);
  assert.throws(() => pickQuestion("history"));
});
