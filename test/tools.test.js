import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync, crc32 } from "node:zlib";
import { api, download, signIn } from "./helpers.js";
import { mrpackFiles, clearModrinthCache } from "../src/modrinth.js";

// Builds a real RGBA PNG of the given size.
function png(width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(height * (1 + width * 4), 0x80);
  for (let y = 0; y < height; y++) raw[y * (1 + width * 4)] = 0;
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

// ---------- Texture Forge ----------
test("texture packs zip 16x16 drawings into the right Minecraft paths", async () => {
  const { cookie } = signIn("artist@example.com");
  const r = await download("/api/texturepack", { cookie, body: {
    name: "Ruby Pack", gameVersion: "1.21.1",
    textures: [{ target: "item/diamond_sword", png: png(16, 16) }, { target: "block/dirt", png: png(16, 16) }],
  } });
  assert.equal(r.status, 200);
  assert.equal(r.type, "application/zip");
  for (const name of ["pack.mcmeta", "pack.png", "assets/minecraft/textures/item/diamond_sword.png", "assets/minecraft/textures/block/dirt.png"]) {
    assert.ok(r.buf.includes(name), `zip should contain ${name}`);
  }
  const saved = (await api("/api/creations", { cookie })).body.creations[0];
  assert.deepEqual([saved.kind, saved.name], ["texturepack", "Ruby Pack"]);
});

test("texture packs reject wrong sizes, unknown targets and non-PNG data", async () => {
  const bad = [
    [{ target: "item/diamond_sword", png: png(32, 32) }, /16 by 16/],
    [{ target: "item/../../evil", png: png(16, 16) }, /doesn't support/],
    [{ target: "item/apple", png: "data:image/png;base64,aGVsbG8=" }, /valid PNG/],
    [{ target: "item/apple", png: "javascript:alert(1)" }, /PNG image/],
  ];
  for (const [texture, message] of bad) {
    const r = await api("/api/texturepack", { method: "POST", body: { gameVersion: "1.21.1", textures: [texture] } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, message);
  }
  const noVersion = await api("/api/texturepack", { method: "POST", body: { gameVersion: "0.0", textures: [{ target: "item/apple", png: png(16, 16) }] } });
  assert.equal(noVersion.status, 400);
});

// ---------- Modpack Forge (Modrinth responses simulated) ----------
const realFetch = globalThis.fetch;
const file = (name, host = "cdn.modrinth.com") => ({
  url: `https://${host}/data/x/versions/y/${name}`, filename: name, primary: true, size: 1234,
  hashes: { sha1: "a".repeat(40), sha512: "b".repeat(128) },
});
const VERSIONS = {
  sodium: [{ version_type: "beta", version_number: "0.6.0-beta", files: [file("sodium-beta.jar")], dependencies: [] },
           { version_type: "release", version_number: "0.5.11", files: [file("sodium-0.5.11.jar")],
             dependencies: [{ project_id: "fabric-api", dependency_type: "required" }, { project_id: "modmenu", dependency_type: "optional" }] }],
  "fabric-api": [{ version_type: "release", version_number: "0.102.0", files: [file("fabric-api-0.102.0.jar")], dependencies: [] }],
  oldmod: [],
  shady: [{ version_type: "release", version_number: "1.0", files: [file("shady.jar", "evil.example")], dependencies: [] }],
};
const PROJECTS = {
  sodium: { id: "sodium", title: "Sodium", client_side: "required", server_side: "unsupported" },
  "fabric-api": { id: "fabric-api", title: "Fabric API", client_side: "required", server_side: "required" },
  oldmod: { id: "oldmod", title: "Old Mod", client_side: "optional", server_side: "optional" },
  shady: { id: "shady", title: "Shady Mod", client_side: "required", server_side: "required" },
};
function fakeModrinth(input, init) {
  const u = new URL(typeof input === "string" ? input : input.url);
  const json = data => Promise.resolve(new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } }));
  if (u.hostname === "meta.fabricmc.net") return json([{ version: "0.17.0-beta", stable: false }, { version: "0.16.14", stable: true }]);
  if (u.hostname !== "api.modrinth.com") return realFetch(input, init);
  let m;
  if ((m = u.pathname.match(/^\/v2\/project\/([^/]+)\/version$/))) return json(VERSIONS[m[1]] ?? []);
  if (u.pathname === "/v2/projects") return json(JSON.parse(u.searchParams.get("ids")).map(id => PROJECTS[id]).filter(Boolean));
  if (u.pathname === "/v2/search") return json({ hits: [{ project_id: "sodium", slug: "sodium", title: "Sodium", description: "Fast", icon_url: null, downloads: 9, author: "jelly" }] });
  if (u.pathname === "/v2/tag/game_version") return json([{ version: "1.21.1", version_type: "release" }, { version: "24w14a", version_type: "snapshot" }]);
  return Promise.resolve(new Response("not found", { status: 404 }));
}

test("modpack search and versions go through Modrinth", async () => {
  globalThis.fetch = fakeModrinth; clearModrinthCache();
  try {
    assert.deepEqual((await api("/api/modrinth/versions")).body.versions, ["1.21.1"]);
    const r = await api("/api/modrinth/search?q=sodium&version=1.21.1");
    assert.equal(r.body.results[0].title, "Sodium");
    assert.equal((await api("/api/modrinth/search?q=x&version=1.21.1%20OR%201")).status, 400);
  } finally { globalThis.fetch = realFetch; }
});

test("modpack plans add required dependencies and skip unavailable mods", async () => {
  globalThis.fetch = fakeModrinth; clearModrinthCache();
  try {
    const r = await api("/api/modpack/plan", { method: "POST", body: { gameVersion: "1.21.1", projectIds: ["sodium", "oldmod", "shady"] } });
    assert.equal(r.status, 200);
    const { plan } = r.body;
    assert.equal(plan.loaderVersion, "0.16.14");
    assert.deepEqual(plan.files.map(f => [f.title, f.required, f.versionNumber]),
      [["Sodium", false, "0.5.11"], ["Fabric API", true, "0.102.0"]]);
    assert.deepEqual(plan.skipped.map(s => s.title).sort(), ["Old Mod", "Shady Mod"]);
  } finally { globalThis.fetch = realFetch; }
});

test("modpacks download as .mrpack files", async () => {
  globalThis.fetch = fakeModrinth; clearModrinthCache();
  try {
    const { cookie } = signIn("packer@example.com");
    const r = await download("/api/modpack", { cookie, body: { name: "Fast Pack", gameVersion: "1.21.1", projectIds: ["sodium"] } });
    assert.equal(r.status, 200);
    assert.equal(r.type, "application/x-modrinth-modpack+zip");
    assert.match(r.disposition, /Fast-Pack\.mrpack/);
    assert.ok(r.buf.includes("modrinth.index.json"));
    assert.equal((await api("/api/creations", { cookie })).body.creations[0].kind, "modpack");
    const none = await api("/api/modpack", { method: "POST", body: { gameVersion: "1.21.1", projectIds: ["oldmod"] } });
    assert.equal(none.status, 400);
  } finally { globalThis.fetch = realFetch; }
});

test("the .mrpack index follows Modrinth's format", () => {
  const plan = { gameVersion: "1.21.1", loaderVersion: "0.16.14", files: [{
    path: "mods/sodium.jar", hashes: { sha1: "a", sha512: "b" }, env: { client: "required", server: "unsupported" },
    downloads: ["https://cdn.modrinth.com/x"], fileSize: 10, title: "Sodium", projectId: "sodium" }] };
  const index = JSON.parse(mrpackFiles(plan, { name: "Pack", summary: "Fast" })["modrinth.index.json"]);
  assert.equal(index.formatVersion, 1);
  assert.equal(index.game, "minecraft");
  assert.deepEqual(index.dependencies, { minecraft: "1.21.1", "fabric-loader": "0.16.14" });
  assert.deepEqual(Object.keys(index.files[0]).sort(), ["downloads", "env", "fileSize", "hashes", "path"]);
});
