// Roblox Forge: a free tool that turns a few choices into a Rojo project for Roblox
// Studio. Works without an account; signed-in downloads are saved as creations.
import express from "express";
import { rateLimit } from "./limit.js";
import { streamZip } from "./modgen.js";
import { saveCreation } from "./tools.js";
import { robloxFiles, robloxPreview, robloxOptions, isOptionError, slug } from "./robloxgen.js";

export const robloxRouter = express.Router();

// Bad options are the visitor's to fix (400); anything else is our bug.
function optionError(res, e) {
  if (!isOptionError(e)) throw e;
  res.status(400).json({ error: e.message });
}

robloxRouter.get("/options", (_req, res) => res.json(robloxOptions()));

robloxRouter.post("/preview", rateLimit({ windowMs: 60_000, max: 120 }), (req, res) => {
  try { res.json(robloxPreview(req.body ?? {}, req.body?.open)); }
  catch (e) { optionError(res, e); }
});

robloxRouter.post("/zip", rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  let project;
  try { project = robloxFiles(req.body ?? {}); } catch (e) { return optionError(res, e); }
  saveCreation(req, "roblox", project.options.name);
  // The download's file name is slugged, so nothing typed reaches the header raw.
  streamZip(project.files, res, slug(project.options.name));
});
