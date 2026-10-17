import test from "node:test";
import assert from "node:assert/strict";
import { formatDuration, MAX_TIMEOUT_MS, parseDuration } from "../src/lib/duration.js";

const M = 60_000;
const H = 60 * M;
const D = 24 * H;

test("parseDuration understands short and long units", () => {
  assert.equal(parseDuration("30s"), 30_000);
  assert.equal(parseDuration("10m"), 10 * M);
  assert.equal(parseDuration("2h"), 2 * H);
  assert.equal(parseDuration("1d"), D);
  assert.equal(parseDuration("1w"), 7 * D);
  assert.equal(parseDuration("1h30m"), 90 * M);
  assert.equal(parseDuration("1h 30m"), 90 * M);
  assert.equal(parseDuration("10 minutes"), 10 * M);
  assert.equal(parseDuration("2 Days"), 2 * D);
  assert.equal(parseDuration("5mins"), 5 * M);
  assert.equal(parseDuration("28d"), MAX_TIMEOUT_MS);
});

test("parseDuration rejects things it can't read", () => {
  for (const bad of ["", "10", "m", "abc", "10x", "1h banana", "0m", "-5m", null, undefined]) {
    assert.equal(parseDuration(bad), null, String(bad));
  }
});

test("formatDuration shows the two largest units", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(45_000), "45s");
  assert.equal(formatDuration(5 * H + 12 * M + 9_000), "5h 12m");
  assert.equal(formatDuration(D + 2 * H), "1d 2h");
  assert.equal(formatDuration(3 * M), "3m");
  assert.equal(formatDuration(-100), "0s");
});
