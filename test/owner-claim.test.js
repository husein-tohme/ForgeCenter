import { test } from "node:test";
import assert from "node:assert/strict";
import { api, db, signIn } from "./helpers.js";
import { ownerSetupCode } from "../src/auth.js";

test("the site owner is claimed once, only with the code from the server log", async () => {
  db.exec("DELETE FROM site_owner");
  const me = signIn("claimer@example.com", "claimer");
  const other = signIn("latecomer@example.com", "latecomer");
  assert.equal((await api("/api/me/owner-claim", { cookie: me.cookie })).body.open, true);

  // Just typing an email (or a wrong code) does nothing.
  const wrong = await api("/api/me/owner-claim", { method: "POST", cookie: me.cookie, body: { code: "claimer@example.com" } });
  assert.equal(wrong.status, 403);

  const code = ownerSetupCode();
  const ok = await api("/api/me/owner-claim", { method: "POST", cookie: me.cookie, body: { code: code.toLowerCase() } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.isAdmin, true);
  assert.equal(ok.body.user.ageGroup, "adult");

  // Closed for good, for everyone, even with the old code.
  assert.equal((await api("/api/me/owner-claim", { cookie: other.cookie })).body.open, false);
  const late = await api("/api/me/owner-claim", { method: "POST", cookie: other.cookie, body: { code } });
  assert.equal(late.status, 410);
  assert.equal((await api("/api/me", { cookie: other.cookie })).body.user.isAdmin, false);
  db.exec("DELETE FROM site_owner");
});
