import { test } from "node:test";
import assert from "node:assert/strict";
import { api, signIn } from "./helpers.js";
import { lookup } from "../src/forgeai.js";

test("the store says payments open soon until Stripe is set up", async () => {
  const { cookie } = signIn("seller");
  await api("/api/repos", { method: "POST", cookie, body: { name: "pack" } });
  assert.equal((await api("/api/store/products", { method: "POST", cookie, body: { title: "Pack", priceCents: 10, repo: "pack" } })).status, 400);
  assert.equal((await api("/api/store/products", { method: "POST", cookie, body: { title: "Pack", priceCents: 299, repo: "nope" } })).status, 400);
  const p = await api("/api/store/products", { method: "POST", cookie, body: { title: "Pack", priceCents: 299, repo: "pack" } });
  assert.equal(p.status, 201);
  const buyer = signIn("buyer");
  const buy = await api(`/api/store/products/${p.body.product.id}/checkout`, { method: "POST", cookie: buyer.cookie, body: {} });
  assert.equal(buy.status, 503);
  assert.equal(buy.body.soon, true);
  assert.equal((await api("/api/store/products?user=seller")).body.products.length, 1);
  assert.equal((await api(`/download/1`, { cookie: buyer.cookie })).status, 404);
});

test("teens can't start selling", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_" + "x".repeat(10);
  const teen = signIn("young", { age: "teen" });
  assert.equal((await api("/api/store/connect", { method: "POST", cookie: teen.cookie, body: {} })).status, 403);
  delete process.env.STRIPE_SECRET_KEY;
});

test("Forge AI answers from its own knowledge base", async () => {
  assert.equal(lookup("how do I run a website from my repo")[0].title, "Running a website from a repo");
  assert.equal(lookup("hello world c++")[0].title, "Hello world in C++");
  assert.equal(lookup("can I sell robux")[0].title, "What can't be sold");
  const r = await api("/api/ai/ask", { method: "POST", body: { question: "how do I get paid" } });
  assert.match(r.body.reply, /Stripe/);
  const none = await api("/api/ai/ask", { method: "POST", body: { question: "zzzz qqqq" } });
  assert.match(none.body.reply, /don't know that one/);
});
