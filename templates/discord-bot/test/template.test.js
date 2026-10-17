import test from "node:test";
import assert from "node:assert/strict";
import { renderTemplate } from "../src/lib/template.js";
import { renderWelcome, welcomeValues } from "../src/features/welcome.js";
import { DEFAULT_WELCOME_MESSAGE } from "../src/lib/settings.js";

test("fills in placeholders", () => {
  assert.equal(
    renderTemplate("Welcome {user} to {server}!", { user: "<@1>", server: "Forge" }),
    "Welcome <@1> to Forge!",
  );
});

test("placeholders are case-insensitive and can repeat", () => {
  assert.equal(renderTemplate("{USER} {User} {user}", { user: "x" }), "x x x");
});

test("unknown placeholders are left alone", () => {
  assert.equal(renderTemplate("Hi {user}, {oops}", { user: "Sam" }), "Hi Sam, {oops}");
});

test("a typed \\n becomes a line break", () => {
  assert.equal(renderTemplate("Line 1\\nLine 2", {}), "Line 1\nLine 2");
});

test("values are not re-scanned for placeholders", () => {
  // A server literally named "{user}" must not be replaced a second time.
  assert.equal(renderTemplate("{server}", { server: "{user}", user: "nope" }), "{user}");
});

test("numbers are converted to text", () => {
  assert.equal(renderTemplate("#{membercount}", { membercount: 42 }), "#42");
});

test("welcome message uses member details and falls back to the default", () => {
  const member = { id: "123", displayName: "Steve", guild: { name: "Blocky", memberCount: 7 } };
  assert.deepEqual(welcomeValues(member), { user: "<@123>", username: "Steve", server: "Blocky", membercount: 7 });
  assert.equal(renderWelcome("Hi {username} ({user}) from {server}", member), "Hi Steve (<@123>) from Blocky");
  assert.equal(renderWelcome(null, member), DEFAULT_WELCOME_MESSAGE
    .replace("{server}", "Blocky").replace("{user}", "<@123>").replace("{membercount}", "7"));
});

test("welcome message is cut to Discord's 2000 character limit", () => {
  const member = { id: "1", displayName: "A", guild: { name: "x".repeat(900), memberCount: 1 } };
  assert.ok(renderWelcome("{server}{server}{server}", member).length <= 2000);
});
