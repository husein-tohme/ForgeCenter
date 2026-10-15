import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { api, db, makeOrder, sendWebhook, signIn } from "./helpers.js";
import { reconcileServices } from "../src/services.js";
import { createBotRunner } from "../src/botrunner.js";
import { encrypt, decrypt } from "../src/secrets.js";
import { setEmailTransport } from "../src/email.js";
import { clearPanelCache } from "../src/pterodactyl.js";

const PANEL_ENV = {
  PTERODACTYL_URL: "https://panel.test", PTERODACTYL_APP_KEY: "ptla_test", PTERODACTYL_CLIENT_KEY: "ptlc_test",
  PTERODACTYL_NEST_ID: "1", PTERODACTYL_EGG_ID: "5", PTERODACTYL_LOCATION_ID: "2",
};
Object.assign(process.env, PANEL_ENV, { SECRET_KEY: "test-secret-key-that-is-long-enough-123" });

const emails = [];
setEmailTransport(async m => { emails.push(m); return true; });

// ---------- Simulated Pterodactyl panel and Discord ----------
const realFetch = globalThis.fetch;
let panel, calls, discordApp, panelDown;
beforeEach(() => {
  clearPanelCache();
  panel = { users: new Map(), servers: new Map(), nextId: 1 };
  calls = [];
  panelDown = false;
  discordApp = { status: 200, body: { id: "4242", name: "Steve's Bot", flags: 1 << 14 } };
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    const json = (data, status = 200) => new Response(data === null ? null : JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    if (u.hostname === "discord.com") {
      assert.match(init.headers.Authorization, /^Bot /);
      return json(discordApp.body, discordApp.status);
    }
    if (u.hostname === "api.modrinth.com") {
      if (u.pathname === "/v2/project/luckperms/version") {
        assert.deepEqual(JSON.parse(u.searchParams.get("loaders")), ["paper", "purpur", "spigot", "bukkit"]);
        return JSON.parse(u.searchParams.get("game_versions"))[0] === "1.21.1"
          ? json([{ version_type: "release", version_number: "5.4.140", files: [{ primary: true, filename: "LuckPerms-Bukkit-5.4.140.jar",
              url: "https://cdn.modrinth.com/data/Vebnzrzj/versions/abc/LuckPerms-Bukkit-5.4.140.jar" }] }])
          : json([]);
      }
      if (u.pathname === "/v2/project/luckperms") return json({ id: "Vebnzrzj", title: "LuckPerms" });
      return json([], 404);
    }
    if (u.hostname !== "panel.test") return realFetch(input, init);
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: u.pathname, body, key: init.headers.Authorization });
    if (panelDown) return json({ errors: [{ detail: "Panel is down" }] }, 500);
    let m;
    if ((m = u.pathname.match(/^\/api\/application\/users\/external\/(.+)$/))) {
      const user = panel.users.get(decodeURIComponent(m[1]));
      return user ? json({ attributes: user }) : json({ errors: [{ detail: "Not found" }] }, 404);
    }
    if (u.pathname === "/api/application/users" && method === "POST") {
      const user = { id: panel.nextId++, ...body };
      panel.users.set(body.external_id, user);
      return json({ attributes: user }, 201);
    }
    if (u.pathname === "/api/application/nests/1/eggs/5") {
      return json({ attributes: { docker_image: "ghcr.io/pterodactyl/yolks:java_21", startup: "java -jar {{SERVER_JARFILE}}",
        relationships: { variables: { data: [{ attributes: { env_variable: "SERVER_JARFILE", default_value: "server.jar" } }] } } } });
    }
    if ((m = u.pathname.match(/^\/api\/application\/servers\/external\/(.+)$/))) {
      const server = panel.servers.get(decodeURIComponent(m[1]));
      return server ? json({ attributes: server }) : json({ errors: [{ detail: "Not found" }] }, 404);
    }
    if (u.pathname === "/api/application/servers" && method === "POST") {
      const id = panel.nextId++;
      const server = { id, identifier: `abcd${id}`, allocation: 77, ...body };
      panel.servers.set(body.external_id, server);
      return json({ attributes: server }, 201);
    }
    if ((m = u.pathname.match(/^\/api\/application\/servers\/(\d+)$/)) && method === "GET") {
      const server = [...panel.servers.values()].find(s => s.id === Number(m[1]));
      return json({ attributes: { ...server, relationships: { allocations: { data: [
        { attributes: { id: 76, ip: "10.0.0.5", alias: null, port: 25566 } },
        { attributes: { id: 77, ip: "10.0.0.5", alias: "mc1.forgecenter.test", port: 25565 } }] } } } });
    }
    if (u.pathname.match(/^\/api\/application\/servers\/\d+(\/(suspend|unsuspend))?$/)) return json(null, 204);
    if (u.pathname.match(/^\/api\/client\/servers\/\w+\/(power|command|files\/pull|files\/delete)$/)) return json(null, 204);
    if (u.pathname.match(/^\/api\/client\/servers\/\w+\/files\/list$/)) {
      return json({ data: [{ attributes: { name: "EssentialsX.jar", size: 1200000, is_file: true } },
        { attributes: { name: "EssentialsX", size: 0, is_file: false } }, { attributes: { name: "notes.txt", size: 10, is_file: true } }] });
    }
    if (u.pathname.match(/^\/api\/client\/servers\/\w+\/resources$/)) {
      return json({ attributes: { current_state: "running", is_suspended: false,
        resources: { memory_bytes: 1024 * 1048576, cpu_absolute: 37.4, disk_bytes: 2048 * 1048576, uptime: 3600_000 } } });
    }
    return json({ errors: [{ detail: `unexpected ${method} ${u.pathname}` }] }, 404);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

async function paidOrder(email, product, subscription = null) {
  const who = signIn(email);
  const id = makeOrder(who.user.id, product);
  await sendWebhook({ id: `evt_${Math.random()}`, type: "checkout.session.completed", data: { object: {
    mode: subscription ? "subscription" : "payment", payment_status: "paid", subscription, metadata: { order_id: String(id) } } } });
  return { ...who, orderId: id, service: () => db.prepare("SELECT * FROM services WHERE order_id = ?").get(id) };
}

// ---------- Minecraft servers ----------
test("a paid hosting order becomes a Minecraft server with the advertised limits", async () => {
  const o = await paidOrder("miner@example.com", "mcserver", "sub_mc1");
  assert.equal(o.service().state, "provisioning");
  await reconcileServices();
  const s = o.service();
  assert.equal(s.state, "active");
  assert.equal(s.address, "mc1.forgecenter.test:25565");
  const create = calls.find(c => c.method === "POST" && c.path === "/api/application/servers").body;
  assert.deepEqual(create.limits, { memory: 2048, swap: 0, disk: 102400, io: 500, cpu: 100 });
  assert.equal(create.external_id, `forgecenter-order-${o.orderId}`);
  assert.deepEqual(create.deploy.locations, [2]);
  assert.equal(create.environment.SERVER_JARFILE, "server.jar");
  assert.equal(calls.find(c => c.path === "/api/application/users").body.email, "miner@example.com");
  const order = (await api(`/api/orders/${o.orderId}`, { cookie: o.cookie })).body.order;
  assert.equal(order.status, "delivered");
  assert.equal(order.service.address, "mc1.forgecenter.test:25565");
  assert.match(order.service.panelUrl, /^https:\/\/panel\.test\/server\/abcd/);
});

test("retries never create a second server", async () => {
  const o = await paidOrder("retry@example.com", "mcserver", "sub_mc2");
  await reconcileServices();
  db.prepare("UPDATE services SET state = 'provisioning' WHERE id = ?").run(o.service().id); // pretend the first run didn't finish
  await reconcileServices();
  assert.equal(calls.filter(c => c.method === "POST" && c.path === "/api/application/servers").length, 1);
  assert.equal(o.service().state, "active");
});

test("without panel settings, orders wait instead of failing", async () => {
  delete process.env.PTERODACTYL_URL;
  try {
    const o = await paidOrder("early@example.com", "mcserver", "sub_mc3");
    await reconcileServices();
    assert.equal(o.service().state, "provisioning");
    assert.equal(o.service().attempts, 0);
    assert.match(o.service().last_error, /isn't set up/);
  } finally { process.env.PTERODACTYL_URL = PANEL_ENV.PTERODACTYL_URL; }
});

test("panel errors back off, then give up and email the owner", async () => {
  const o = await paidOrder("unlucky@example.com", "mcserver", "sub_mc4");
  panelDown = true;
  emails.length = 0;
  let at = Date.now();
  await reconcileServices(at);
  assert.equal(o.service().attempts, 1);
  assert.ok(o.service().next_attempt_at > at);
  const before = calls.length;
  await reconcileServices(at + 1000); // too soon: skipped
  assert.equal(calls.length, before);
  for (let i = 0; i < 10; i++) { at += 2 * 60 * 60_000; await reconcileServices(at); }
  assert.equal(o.service().state, "failed");
  assert.match(o.service().last_error, /Panel is down/);
  assert.ok(emails.some(m => m.to.includes("owner@example.com") && /Setup failed/.test(m.subject)));

  // The owner fixes the panel and retries.
  panelDown = false;
  const owner = signIn("owner@example.com");
  await api(`/api/admin/services/${o.service().id}/retry`, { method: "POST", body: {}, cookie: owner.cookie });
  await new Promise(r => setTimeout(r, 50));
  assert.equal(o.service().state, "active");
});

test("missed payments suspend the server; cancelling deletes it after 7 days", async () => {
  const o = await paidOrder("billing@example.com", "mcserver", "sub_mc5");
  await reconcileServices();
  const sub = status => sendWebhook({ id: `evt_${Math.random()}`, type: "customer.subscription.updated", data: { object: { id: "sub_mc5", status, metadata: {} } } });

  await sub("past_due"); await reconcileServices();
  assert.equal(o.service().state, "suspended");
  assert.ok(calls.some(c => c.path.endsWith("/suspend")));

  await sub("active"); await reconcileServices();
  assert.equal(o.service().state, "active");
  assert.ok(calls.some(c => c.path.endsWith("/unsuspend")));

  await sub("canceled");
  const at = Date.now();
  await reconcileServices(at);
  assert.equal(o.service().state, "suspended");
  assert.ok(o.service().delete_after >= at + 7 * 24 * 60 * 60_000 - 1000);
  await reconcileServices(at + 8 * 24 * 60 * 60_000);
  assert.equal(o.service().state, "deleted");
  assert.ok(calls.some(c => c.method === "DELETE"));
});

test("customers control their own server, and only their own", async () => {
  const o = await paidOrder("player@example.com", "mcserver", "sub_mc6");
  await reconcileServices();
  const id = o.service().id;
  const status = (await api(`/api/services/${id}/status`, { cookie: o.cookie })).body;
  assert.deepEqual(status.resources, { state: "running", suspended: false, memoryMb: 1024, cpuPercent: 37, diskMb: 2048, uptimeSeconds: 3600 });

  assert.equal((await api(`/api/services/${id}/power`, { method: "POST", body: { signal: "restart" }, cookie: o.cookie })).status, 200);
  const power = calls.find(c => c.path.endsWith("/power"));
  assert.deepEqual(power.body, { signal: "restart" });
  assert.equal(power.key, "Bearer ptlc_test");
  assert.equal((await api(`/api/services/${id}/power`, { method: "POST", body: { signal: "explode" }, cookie: o.cookie })).status, 400);

  assert.equal((await api(`/api/services/${id}/command`, { method: "POST", body: { command: "/whitelist add Steve" }, cookie: o.cookie })).status, 200);
  assert.deepEqual(calls.find(c => c.path.endsWith("/command")).body, { command: "whitelist add Steve" });
  assert.equal((await api(`/api/services/${id}/command`, { method: "POST", body: { command: "say hi\nop me" }, cookie: o.cookie })).status, 400);

  const stranger = signIn("stranger@example.com");
  assert.equal((await api(`/api/services/${id}/power`, { method: "POST", body: { signal: "stop" }, cookie: stranger.cookie })).status, 404);
});

test("customers install and remove plugins from Modrinth on their server", async () => {
  const o = await paidOrder("plugins@example.com", "mcserver", "sub_mc7");
  await reconcileServices();
  const id = o.service().id;
  const list = await api(`/api/services/${id}/plugins`, { cookie: o.cookie });
  assert.deepEqual(list.body.plugins, [{ name: "EssentialsX.jar", size: 1200000 }]);

  const add = await api(`/api/services/${id}/plugins`, { method: "POST", body: { projectId: "luckperms", gameVersion: "1.21.1" }, cookie: o.cookie });
  assert.equal(add.status, 200);
  assert.equal(add.body.title, "LuckPerms");
  const pull = calls.find(c => c.path.endsWith("/files/pull"));
  assert.deepEqual(pull.body, { url: "https://cdn.modrinth.com/data/Vebnzrzj/versions/abc/LuckPerms-Bukkit-5.4.140.jar",
    directory: "/plugins", filename: "LuckPerms-Bukkit-5.4.140.jar" });

  const tooNew = await api(`/api/services/${id}/plugins`, { method: "POST", body: { projectId: "luckperms", gameVersion: "1.8.9" }, cookie: o.cookie });
  assert.match(tooNew.body.error, /doesn't have a version for Minecraft 1\.8\.9/);

  assert.equal((await api(`/api/services/${id}/plugins/EssentialsX.jar`, { method: "DELETE", body: {}, cookie: o.cookie })).status, 200);
  assert.deepEqual(calls.find(c => c.path.endsWith("/files/delete")).body, { root: "/plugins", files: ["EssentialsX.jar"] });
  const sneaky = await api(`/api/services/${id}/plugins/${encodeURIComponent("../server.properties")}`, { method: "DELETE", body: {}, cookie: o.cookie });
  assert.equal(sneaky.status, 400);

  const stranger = signIn("nosy@example.com");
  assert.equal((await api(`/api/services/${id}/plugins`, { cookie: stranger.cookie })).status, 404);
});

// ---------- Discord bots ----------
// A made-up token, built from parts so it never looks like a real one to secret scanners.
const TOKEN = ["fake".repeat(6), "test00", "x".repeat(38)].join(".");

test("bot orders wait for a token, check it with Discord and store it encrypted", async () => {
  const o = await paidOrder("botowner@example.com", "discord");
  const s = o.service();
  assert.equal(s.state, "waiting_setup");
  const post = token => api(`/api/services/${s.id}/bot`, { method: "POST", body: { token }, cookie: o.cookie });

  assert.match((await post("hello")).body.error, /doesn't look like a bot token/);
  discordApp = { status: 401, body: { message: "401: Unauthorized" } };
  assert.match((await post(TOKEN)).body.error, /isn't valid/);
  discordApp = { status: 200, body: { id: "4242", name: "Steve's Bot", flags: 0 } };
  assert.match((await post(TOKEN)).body.error, /Server Members Intent/);

  discordApp = { status: 200, body: { id: "4242", name: "Steve's Bot", flags: 1 << 14 } };
  const ok = await post(TOKEN);
  assert.equal(ok.status, 200);
  assert.match(ok.body.warning, /Message Content Intent/);
  assert.match(ok.body.service.bot.inviteUrl, /client_id=4242&permissions=1099780189206/);
  const stored = o.service();
  assert.equal(stored.state, "active");
  assert.ok(!stored.bot_token_enc.includes(TOKEN));
  assert.equal(decrypt(stored.bot_token_enc), TOKEN);
  assert.equal((await api(`/api/orders/${o.orderId}`, { cookie: o.cookie })).body.order.status, "delivered");
});

test("bot hosting refuses to store tokens without SECRET_KEY", async () => {
  const key = process.env.SECRET_KEY;
  delete process.env.SECRET_KEY;
  try {
    const o = await paidOrder("nokey@example.com", "discord");
    assert.equal((await api(`/api/services/${o.service().id}/bot`, { method: "POST", body: { token: TOKEN }, cookie: o.cookie })).status, 503);
  } finally { process.env.SECRET_KEY = key; }
});

test("secrets are encrypted with a fresh IV and tampering is detected", () => {
  const a = encrypt("hello"), b = encrypt("hello");
  assert.notEqual(a, b);
  assert.equal(decrypt(a), "hello");
  const parts = a.split(":");
  parts[3] = Buffer.from("jello").toString("base64");
  assert.throws(() => decrypt(parts.join(":")));
});

// ---------- Bot runner ----------
function fakeSpawner() {
  const spawned = [];
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter();
    Object.assign(child, { cmd, args, env: opts.env, cwd: opts.cwd, stdout: new PassThrough(), stderr: new PassThrough(), killed: false });
    child.kill = () => { child.killed = true; setImmediate(() => child.emit("exit", null)); };
    spawned.push(child);
    return child;
  };
  return { spawn, spawned };
}
const tickWith = async (runner, spawned, ...exitCodes) => {
  const done = runner.tick();
  for (const code of exitCodes) {
    await new Promise(r => setImmediate(r));
    spawned.at(-1).emit("exit", code);
  }
  await done;
};

test("the bot runner starts each bot with only its own settings and restarts crashes", async () => {
  const o = await paidOrder("runner@example.com", "discord");
  await api(`/api/services/${o.service().id}/bot`, { method: "POST", body: { token: TOKEN }, cookie: o.cookie });
  db.prepare("UPDATE services SET state = 'deleted' WHERE kind = 'discord_bot' AND id != ?").run(o.service().id);

  let clock = 1_000_000;
  const { spawn, spawned } = fakeSpawner();
  const runner = createBotRunner({ spawn, templateDir: "/tpl", dataDir: mkdtempSync(join(tmpdir(), "bots-")), clock: () => clock });

  // First run registers slash commands, then starts the bot.
  await tickWith(runner, spawned, 0);
  assert.deepEqual(spawned.map(c => c.args.slice(1)), [["src/register.js", "--global"], ["src/index.js"]]);
  const env = spawned[1].env;
  assert.equal(env.DISCORD_TOKEN, TOKEN);
  assert.equal(env.CLIENT_ID, "4242");
  assert.match(env.DATABASE_PATH, /bot-\d+\.db$/);
  for (const secret of ["SECRET_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "PTERODACTYL_APP_KEY"]) assert.equal(env[secret], undefined, secret);
  assert.equal(o.service().commands_registered, 1);

  clock += 20_000;
  await runner.tick();
  assert.equal(o.service().bot_status, "running");

  // A crash is recorded and the bot comes back after a short wait, without re-registering.
  spawned[1].stderr.write("Error: Used disallowed intents\n");
  await new Promise(r => setImmediate(r));
  spawned[1].emit("exit", 1);
  assert.equal(o.service().bot_status, "crashed");
  assert.match(o.service().log_tail, /disallowed intents/);
  await runner.tick();
  assert.equal(spawned.length, 2, "waits before restarting");
  clock += 6_000;
  await runner.tick();
  assert.deepEqual(spawned.at(-1).args.slice(1), ["src/index.js"]);

  // The customer presses Restart.
  await api(`/api/services/${o.service().id}/restart`, { method: "POST", body: {}, cookie: o.cookie });
  await runner.tick();
  assert.equal(spawned[2].killed, true);
  assert.equal(spawned.length, 4);

  // Cancelled orders stop the bot.
  db.prepare("UPDATE orders SET status = 'canceled' WHERE id = ?").run(o.orderId);
  await runner.tick();
  assert.equal(spawned[3].killed, true);
  assert.equal(o.service().bot_status, "stopped");
});
