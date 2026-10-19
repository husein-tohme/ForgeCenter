import { test } from "node:test";
import assert from "node:assert/strict";
import { api, signIn } from "./helpers.js";
import { looksLikeScam } from "../src/messages.js";

test("people can message each other, with unread counts", async () => {
  const a = signIn("alice"), b = signIn("bob");
  assert.equal((await api("/api/messages/bob", { method: "POST", cookie: a.cookie, body: { body: "Hi Bob, does your pack work on 1.21?" } })).status, 201);
  assert.equal((await api("/api/messages/unread", { cookie: b.cookie })).body.unread, 1);
  const inbox = await api("/api/messages", { cookie: b.cookie });
  assert.equal(inbox.body.threads[0].username, "alice");
  const thread = await api("/api/messages/alice", { cookie: b.cookie });
  assert.equal(thread.body.messages[0].body, "Hi Bob, does your pack work on 1.21?");
  assert.equal(thread.body.messages[0].mine, false);
  assert.equal((await api("/api/messages/unread", { cookie: b.cookie })).body.unread, 0);
  assert.equal((await api("/api/messages/alice", { method: "POST", cookie: a.cookie, body: { body: "x" } })).status, 404); // not yourself
  assert.equal((await api("/api/messages/bob", { method: "POST", cookie: a.cookie, body: { body: "" } })).status, 400);
});

test("obvious scams aren't delivered", async () => {
  for (const s of ["send me your password and I'll add the item", "pay with gift cards instead", "free robux here", "give me the 2fa code"]) assert.ok(looksLikeScam(s), s);
  for (const s of ["what's the password for the zip? jk", "can I pay on Forgehub?", "nice robux game"]) assert.ok(!looksLikeScam(s), s);
  const a = signIn("scammer"), b = signIn("target");
  const r = await api("/api/messages/target", { method: "POST", cookie: a.cookie, body: { body: "Pay me in bitcoin instead, it's cheaper" } });
  assert.equal(r.status, 422);
  assert.equal((await api("/api/messages", { cookie: b.cookie })).body.threads.length, 0);
});

test("blocking stops messages both ways", async () => {
  const a = signIn("blocker"), b = signIn("pest");
  await api("/api/messages/blocker", { method: "POST", cookie: b.cookie, body: { body: "hey" } });
  await api("/api/messages/pest/block", { method: "POST", cookie: a.cookie, body: {} });
  assert.equal((await api("/api/messages/blocker", { method: "POST", cookie: b.cookie, body: { body: "hey?" } })).status, 403);
  assert.equal((await api("/api/messages/pest", { method: "POST", cookie: a.cookie, body: { body: "bye" } })).status, 403);
  assert.equal((await api("/api/messages/pest", { cookie: a.cookie })).body.canSend, false);
});

test("messages need a finished, signed-in account", async () => {
  assert.equal((await api("/api/messages")).status, 401);
});
