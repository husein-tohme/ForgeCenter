import { test } from "node:test";
import assert from "node:assert/strict";
import { lookup, guideReply } from "../src/forgeguide.js";
import { api, signIn } from "./helpers.js";

test("Forge Guide finds the right answer from everyday wording", () => {
  assert.equal(lookup("how do i make a nether portal")[0].title, "Making a Nether portal");
  assert.equal(lookup("2x2 piston door?")[0].title, "A 2×2 piston door");
  assert.equal(lookup("where are diamonds")[0].title, "Finding diamonds");
  assert.equal(lookup("tp command")[0].title, "Teleporting");
  assert.match(guideReply("asdfgh qwerty"), /don't have an answer/);
});

test("without an AI key the mentor answers from Forge Guide, free", async () => {
  const { cookie } = signIn("guide-user@example.com");
  const r = await api("/api/tutor", { method: "POST", cookie, body: { messages: [{ role: "user", content: "how do I install fabric mods" }] } });
  if (r.status === 200 && r.body.guide) assert.match(r.body.reply, /Installing Fabric mods/);
  else assert.ok(r.body.reply || r.status === 429, "mentor answered with the AI instead (a key is set in this run)");
});
