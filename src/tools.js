// Free creator tools: Mod Forge, Texture Forge and Modpack Forge.
// They work without an account; signed-in users get their creations saved.
import express from "express";
import { db, now } from "./db.js";
import { requireUser } from "./auth.js";
import { rateLimit } from "./limit.js";
import { modFiles, streamZip, createModrinthProject } from "./modgen.js";
import { texturePackFiles, TEXTURE_TARGETS, PACK_FORMATS } from "./texturepack.js";
import { gameVersions, searchMods, planModpack, mrpackFiles, isGameVersion } from "./modrinth.js";

export const toolsRouter = express.Router();

const zipName = name => String(name || "pack").replace(/\W+/g, "-").replace(/^-|-$/g, "") || "pack";
function saveCreation(req, kind, name, url = null) {
  if (req.user) db.prepare("INSERT INTO mods (user_id, kind, name, modrinth_url, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(req.user.id, kind, String(name).slice(0, 60), url, now());
}

// ---------- Mod Forge ----------
toolsRouter.post("/mod/zip", rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  const { name, author, description } = req.body || {};
  if (!name || !author || !description) return res.status(400).json({ error: "Add a mod name, your name and what it adds." });
  saveCreation(req, "mod", name);
  streamZip(modFiles(req.body), res, zipName(name));
});

toolsRouter.post("/mod/modrinth", rateLimit({ windowMs: 60_000, max: 5 }), async (req, res) => {
  const { token, name, description, license = "MIT" } = req.body || {};
  if (!token || !name || !description) return res.status(400).json({ error: "Add a Modrinth token, a mod name and what it adds." });
  try {
    const result = await createModrinthProject({ token, name, description, license });
    saveCreation(req, "mod", name, result.url);
    res.json(result);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ---------- Texture Forge ----------
toolsRouter.get("/texturepack/options", (_req, res) =>
  res.json({ targets: TEXTURE_TARGETS, versions: Object.keys(PACK_FORMATS) }));

toolsRouter.post("/texturepack", rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  let files;
  try { files = texturePackFiles(req.body ?? {}); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  saveCreation(req, "texturepack", req.body.name || "My Texture Pack");
  streamZip(files, res, zipName(req.body.name));
});

// ---------- Modpack Forge ----------
const FALLBACK_VERSIONS = ["1.21.8", "1.21.7", "1.21.6", "1.21.5", "1.21.4", "1.21.1", "1.20.1"];

toolsRouter.get("/modrinth/versions", async (_req, res) => {
  try { res.json({ versions: await gameVersions() }); }
  catch { res.json({ versions: FALLBACK_VERSIONS }); }
});

toolsRouter.get("/modrinth/search", rateLimit({ windowMs: 60_000, max: 60 }), async (req, res) => {
  const query = String(req.query.q ?? "").slice(0, 100);
  const gameVersion = String(req.query.version ?? "");
  if (!isGameVersion(gameVersion)) return res.status(400).json({ error: "Pick a Minecraft version." });
  try { res.json({ results: await searchMods({ query, gameVersion }) }); }
  catch (e) { console.error("Modrinth search failed", e.message); res.status(502).json({ error: "Modrinth didn't answer. Try again in a moment." }); }
});

function modpackInput(body) {
  const gameVersion = body?.gameVersion;
  const ids = Array.isArray(body?.projectIds) ? [...new Set(body.projectIds.filter(id => typeof id === "string" && /^[\w-]{1,64}$/.test(id)))] : [];
  if (!isGameVersion(gameVersion)) throw new Error("Pick a Minecraft version.");
  if (!ids.length) throw new Error("Add at least one mod.");
  if (ids.length > 50) throw new Error("A modpack can start with up to 50 mods.");
  return { gameVersion, projectIds: ids };
}

toolsRouter.post("/modpack/plan", rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  let input;
  try { input = modpackInput(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const plan = await planModpack(input);
    res.json({ plan: { ...plan, files: plan.files.map(({ projectId, title, required, versionNumber, path }) => ({ projectId, title, required, versionNumber, path })) } });
  } catch (e) { console.error("Modpack plan failed", e.message); res.status(502).json({ error: "Modrinth didn't answer. Try again in a moment." }); }
});

toolsRouter.post("/modpack", rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  let input;
  try { input = modpackInput(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  let files;
  try { files = mrpackFiles(await planModpack(input), req.body); }
  catch (e) {
    const known = e.message.startsWith("None of");
    if (!known) console.error("Modpack build failed", e.message);
    return res.status(known ? 400 : 502).json({ error: known ? e.message : "Modrinth didn't answer. Try again in a moment." });
  }
  saveCreation(req, "modpack", req.body.name || "My Modpack");
  streamZip(files, res, zipName(req.body.name), "mrpack");
});

// ---------- Saved creations ----------
toolsRouter.get("/creations", requireUser, (req, res) => {
  res.json({ creations: db.prepare(`SELECT id, kind, name, modrinth_url AS modrinthUrl, created_at AS createdAt
    FROM mods WHERE user_id = ? ORDER BY id DESC LIMIT 100`).all(req.user.id) });
});
