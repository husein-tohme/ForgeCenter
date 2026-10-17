import test from "node:test";
import assert from "node:assert/strict";
import { coinFlip, EIGHT_BALL_ANSWERS, eightBall, parseDice, rollDice, rpsOutcome } from "../src/lib/games.js";

test("parseDice reads common dice notation", () => {
  assert.deepEqual(parseDice("d20"), { count: 1, sides: 20, modifier: 0 });
  assert.deepEqual(parseDice("2d6"), { count: 2, sides: 6, modifier: 0 });
  assert.deepEqual(parseDice("3D8+2"), { count: 3, sides: 8, modifier: 2 });
  assert.deepEqual(parseDice(" 1d4 - 1 "), { count: 1, sides: 4, modifier: -1 });
});

test("parseDice rejects nonsense and silly sizes", () => {
  for (const bad of ["", "abc", "d", "2d", "0d6", "101d6", "1d1", "1d1001", "1d6+1001", "1d6*2", "-1d6"]) {
    assert.equal(parseDice(bad), null, bad);
  }
});

test("rollDice stays in range and adds the modifier", () => {
  const { rolls, total } = rollDice({ count: 3, sides: 6, modifier: 2 }, () => 0.999);
  assert.deepEqual(rolls, [6, 6, 6]);
  assert.equal(total, 20);
  assert.deepEqual(rollDice({ count: 2, sides: 6, modifier: 0 }, () => 0).rolls, [1, 1]);
  for (let i = 0; i < 500; i++) {
    const [roll] = rollDice({ count: 1, sides: 20, modifier: 0 }).rolls;
    assert.ok(roll >= 1 && roll <= 20);
  }
});

test("rock paper scissors rules", () => {
  assert.equal(rpsOutcome("rock", "scissors"), "win");
  assert.equal(rpsOutcome("scissors", "paper"), "win");
  assert.equal(rpsOutcome("paper", "rock"), "win");
  assert.equal(rpsOutcome("rock", "paper"), "lose");
  assert.equal(rpsOutcome("paper", "paper"), "draw");
  assert.throws(() => rpsOutcome("lizard", "rock"));
});

test("coin flip and 8-ball", () => {
  assert.equal(coinFlip(() => 0.1), "Heads");
  assert.equal(coinFlip(() => 0.9), "Tails");
  assert.equal(eightBall(() => 0), EIGHT_BALL_ANSWERS[0]);
  assert.equal(eightBall(() => 0.9999), EIGHT_BALL_ANSWERS.at(-1));
});
