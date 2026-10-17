// Plays /trivia with fake interactions (no Discord connection needed).
import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.js";
import { answerTrivia, startTrivia } from "../src/features/trivia.js";
import { getBalance } from "../src/lib/economy.js";
import { QUESTIONS } from "../src/lib/triviaQuestions.js";

const ctx = () => ({ db: openDatabase(":memory:"), config: { triviaReward: 25 } });
let nextId = 1;

function commandInteraction(userId = "player") {
  const calls = [];
  return {
    id: `session${nextId++}`, guildId: "g", user: { id: userId }, calls,
    reply: async (payload) => calls.push(["reply", payload]),
    editReply: async (payload) => calls.push(["editReply", payload]),
  };
}

function buttonClick(customId, userId = "player") {
  const calls = [];
  return {
    customId, guildId: "g", user: { id: userId }, calls,
    reply: async (payload) => calls.push(["reply", payload]),
    update: async (payload) => calls.push(["update", payload]),
  };
}

/** Reads the posted question and returns the customId of the right / a wrong answer button. */
function buttonsFor(start) {
  const [, payload] = start.calls[0];
  const description = payload.embeds[0].toJSON().description;
  const question = QUESTIONS.find((q) => description.includes(`**${q.question}**`));
  const buttons = payload.components[0].toJSON().components;
  const right = buttons.find((b) => b.label.slice(3) === question.answer);
  const wrong = buttons.find((b) => b !== right);
  return { right: right.custom_id, wrong: wrong.custom_id, count: buttons.length };
}

test("a right answer wins coins and reveals the answer", async () => {
  const c = ctx();
  const start = commandInteraction();
  await startTrivia(start, c, "minecraft");
  const { right, count } = buttonsFor(start);
  assert.equal(count, 4);

  const click = buttonClick(right);
  await answerTrivia(click, c);
  const [kind, payload] = click.calls[0];
  assert.equal(kind, "update");
  assert.match(payload.embeds[0].toJSON().title, /Correct/);
  assert.ok(payload.components[0].toJSON().components.every((b) => b.disabled));
  assert.equal(getBalance(c.db, "g", "player"), 25);
});

test("a wrong answer gives no coins", async () => {
  const c = ctx();
  const start = commandInteraction();
  await startTrivia(start, c);
  const click = buttonClick(buttonsFor(start).wrong);
  await answerTrivia(click, c);
  assert.match(click.calls[0][1].embeds[0].toJSON().title, /Wrong/);
  assert.equal(getBalance(c.db, "g", "player"), 0);
});

test("other people can't answer someone else's question", async () => {
  const c = ctx();
  const start = commandInteraction();
  await startTrivia(start, c);
  const { right } = buttonsFor(start);

  const sneaky = buttonClick(right, "someone-else");
  await answerTrivia(sneaky, c);
  assert.equal(sneaky.calls[0][0], "reply");
  assert.match(sneaky.calls[0][1].content, /is for/);
  assert.equal(getBalance(c.db, "g", "someone-else"), 0);

  await answerTrivia(buttonClick(right), c); // finish the game so its timer is cleared
});

test("each question can only be answered once, and one game per member at a time", async () => {
  const c = ctx();
  const start = commandInteraction();
  await startTrivia(start, c);
  await assert.rejects(startTrivia(commandInteraction(), c), /current trivia question/);

  const { right } = buttonsFor(start);
  await answerTrivia(buttonClick(right), c);
  const again = buttonClick(right);
  await answerTrivia(again, c);
  assert.match(again.calls[0][1].content, /already ended/);
  assert.equal(getBalance(c.db, "g", "player"), 25, "no double reward");

  const next = commandInteraction();
  await startTrivia(next, c); // allowed again now
  await answerTrivia(buttonClick(buttonsFor(next).wrong), c);
});

test("unanswered questions time out after 20 seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const c = ctx();
  const start = commandInteraction();
  await startTrivia(start, c);
  t.mock.timers.tick(20_000);
  await new Promise((resolve) => setImmediate(resolve));
  const [kind, payload] = start.calls.at(-1);
  assert.equal(kind, "editReply");
  assert.match(payload.embeds[0].toJSON().title, /Time's up/);

  const late = buttonClick(buttonsFor(start).right);
  await answerTrivia(late, c);
  assert.match(late.calls[0][1].content, /already ended/);
});
