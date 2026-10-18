import { test, after } from "node:test";
import assert from "node:assert/strict";
import { api, signIn } from "./helpers.js";
import { clearRepoCache } from "../src/github-repos.js";

const realFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (input, init) => {
  const u = String(input?.url ?? input);
  if (u.startsWith("https://api.github.com/users/steve/repos")) {
    calls++;
    return Response.json([
      { name: "ruby-tools", description: "A mod", owner: { login: "steve" }, language: "Java", stargazers_count: 4, fork: false, private: false },
      { name: "forked", owner: { login: "steve" }, fork: true, private: false },
    ]);
  }
  if (u.startsWith("https://api.github.com/users/")) return new Response("{}", { status: 404 });
  return realFetch(input, init);
};
after(() => { globalThis.fetch = realFetch; });

test("a creator page shows its GitHub repos, without forks, cached", async () => {
  clearRepoCache();
  const me = signIn("coder@example.com");
  assert.equal((await api("/api/creators/mine/github", { method: "PUT", cookie: me.cookie, body: { username: "steve" } })).status, 409); // no page yet
  await api("/api/creators/mine", { method: "PUT", cookie: me.cookie, body: { handle: "coder-steve", bio: "", links: [], support: {} } });
  assert.equal((await api("/api/creators/mine/github", { method: "PUT", cookie: me.cookie, body: { username: "bad name!" } })).status, 400);
  const set = await api("/api/creators/mine/github", { method: "PUT", cookie: me.cookie, body: { username: "https://github.com/steve" } });
  assert.equal(set.body.github, "steve");

  const r = await api("/api/creators/coder-steve/repos");
  assert.deepEqual(r.body.repos.map(x => x.name), ["ruby-tools"]);
  assert.equal(r.body.repos[0].url, "https://github.com/steve/ruby-tools");
  await api("/api/creators/coder-steve/repos");
  assert.equal(calls, 1);
});
