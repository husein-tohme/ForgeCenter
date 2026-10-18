// Modpack Forge: search Modrinth and build a .mrpack modpack (Fabric, Quilt, Forge or
// NeoForge) with its required dependencies. Follows the .mrpack format: https://support.modrinth.com/en/articles/8802351
const API = "https://api.modrinth.com/v2";
const USER_AGENT = "ForgeCenter/0.2 (github.com/husein-tohme/ForgeCenter)";
const ALLOWED_DOWNLOAD_HOSTS = new Set(["cdn.modrinth.com", "github.com", "raw.githubusercontent.com", "gitlab.com"]);
const MAX_MODS = 80;

// Short in-memory cache so repeated searches and builds don't hammer Modrinth.
const cache = new Map();
async function getJson(url, ttlMs = 10 * 60_000) {
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.data;
  const r = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!r.ok) throw new Error(`Modrinth returned ${r.status}`);
  const data = await r.json();
  cache.set(url, { data, expires: Date.now() + ttlMs });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return data;
}
export const clearModrinthCache = () => cache.clear();

const q = v => encodeURIComponent(JSON.stringify(v));
export const isGameVersion = v => typeof v === "string" && /^[0-9][\w.\-]{0,15}$/.test(v);

export async function gameVersions() {
  const tags = await getJson(`${API}/tag/game_version`, 6 * 60 * 60_000);
  return tags.filter(t => t.version_type === "release").slice(0, 20).map(t => t.version);
}

// Server plugins are the projects published for these loaders.
const PLUGIN_LOADERS = ["paper", "purpur", "spigot", "bukkit"];

// Mod loaders a modpack can use. Quilt also runs most Fabric mods.
export const LOADERS = {
  fabric: { name: "Fabric", accepts: ["fabric"], dependency: "fabric-loader" },
  quilt: { name: "Quilt", accepts: ["quilt", "fabric"], dependency: "quilt-loader" },
  forge: { name: "Forge", accepts: ["forge"], dependency: "forge" },
  neoforge: { name: "NeoForge", accepts: ["neoforge"], dependency: "neoforge" },
};
export const isLoader = l => Object.hasOwn(LOADERS, l);

export async function searchMods({ query, gameVersion, kind = "mod", loader = "fabric" }) {
  const accepts = LOADERS[isLoader(loader) ? loader : "fabric"].accepts;
  const facets = kind === "plugin"
    ? [PLUGIN_LOADERS.map(l => `categories:${l}`), [`versions:${gameVersion}`]]
    : [["project_type:mod"], accepts.map(l => `categories:${l}`), [`versions:${gameVersion}`]];
  const data = await getJson(`${API}/search?query=${encodeURIComponent(query)}&limit=20&index=relevance&facets=${q(facets)}`);
  return data.hits.map(h => ({
    id: h.project_id, slug: h.slug, title: h.title, description: h.description,
    icon: h.icon_url || null, downloads: h.downloads, author: h.author,
  }));
}

const ENV = v => (v === "optional" || v === "unsupported" ? v : "required");
const allowedDownload = url => {
  try { const u = new URL(url); return u.protocol === "https:" && ALLOWED_DOWNLOAD_HOSTS.has(u.hostname); }
  catch { return false; }
};
const safeFilename = name => String(name).split(/[\\/]/).pop().replace(/[^\w.+\-]/g, "_");

// The newest stable loader build for a Minecraft version, from each loader's own site.
async function loaderVersionFor(loader, gameVersion) {
  if (loader === "fabric") {
    const list = await getJson("https://meta.fabricmc.net/v2/versions/loader", 6 * 60 * 60_000);
    return (list.find(l => l.stable) ?? list[0])?.version;
  }
  if (loader === "quilt") {
    const list = await getJson("https://meta.quiltmc.org/v3/versions/loader", 6 * 60 * 60_000);
    return (list.find(l => !/beta|pre|rc/i.test(l.version)) ?? list[0])?.version;
  }
  if (loader === "forge") {
    const { promos } = await getJson("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json", 6 * 60 * 60_000);
    return promos?.[`${gameVersion}-recommended`] ?? promos?.[`${gameVersion}-latest`];
  }
  // NeoForge numbers its builds after the game: 1.21.1 -> 21.1.x, 1.21 -> 21.0.x.
  const [, minor, patch = "0"] = gameVersion.split(".");
  const { versions = [] } = await getJson("https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge", 6 * 60 * 60_000);
  const matching = versions.filter(v => v.startsWith(`${minor}.${patch}.`));
  return matching.filter(v => !/beta|alpha/i.test(v)).pop() ?? matching.pop();
}

// Resolves each picked mod to its newest file for the loader and game version, plus
// any required dependencies (like Fabric API).
export async function planModpack({ gameVersion, projectIds, loader = "fabric" }) {
  if (!isLoader(loader)) loader = "fabric";
  const picked = new Set(projectIds);
  const queue = [...picked];
  const seen = new Set();
  const files = [];
  const skipped = [];

  while (queue.length && seen.size < MAX_MODS) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const versions = await getJson(`${API}/project/${encodeURIComponent(id)}/version?loaders=${q(LOADERS[loader].accepts)}&game_versions=${q([gameVersion])}`);
    const version = versions.find(v => v.version_type === "release") ?? versions[0];
    const file = version && (version.files.find(f => f.primary) ?? version.files[0]);
    if (!file || !allowedDownload(file.url)) { skipped.push(id); continue; }
    files.push({
      projectId: id, required: !picked.has(id), versionNumber: version.version_number,
      path: `mods/${safeFilename(file.filename)}`,
      hashes: { sha1: file.hashes.sha1, sha512: file.hashes.sha512 },
      downloads: [file.url], fileSize: file.size,
    });
    for (const dep of version.dependencies ?? []) {
      if (dep.dependency_type === "required" && dep.project_id && !seen.has(dep.project_id)) queue.push(dep.project_id);
    }
  }

  const ids = [...new Set([...files.map(f => f.projectId), ...skipped])];
  const projects = ids.length ? await getJson(`${API}/projects?ids=${q(ids)}`) : [];
  const byId = Object.fromEntries(projects.map(p => [p.id, p]));
  for (const f of files) {
    const p = byId[f.projectId];
    f.title = p?.title ?? f.projectId;
    f.env = { client: ENV(p?.client_side), server: ENV(p?.server_side) };
  }

  const loaderVersion = await loaderVersionFor(loader, gameVersion);
  if (!loaderVersion) throw new Error(`None of ${LOADERS[loader].name}'s builds support Minecraft ${gameVersion} yet. Pick another version or loader.`);

  return {
    gameVersion, loader, loaderName: LOADERS[loader].name, loaderVersion, files,
    skipped: skipped.map(id => ({ id, title: byId[id]?.title ?? id })),
  };
}

export function mrpackFiles(plan, { name, summary }) {
  const loader = LOADERS[plan.loader ?? "fabric"];
  if (!plan.files.length) throw new Error(`None of the picked mods have a ${loader.name} version for this Minecraft version.`);
  const title = String(name || "My Modpack").slice(0, 60);
  const index = {
    formatVersion: 1, game: "minecraft", versionId: "1.0.0", name: title,
    ...(summary ? { summary: String(summary).slice(0, 200) } : {}),
    files: plan.files.map(f => ({ path: f.path, hashes: f.hashes, env: f.env, downloads: f.downloads, fileSize: f.fileSize })),
    dependencies: { minecraft: plan.gameVersion, [loader.dependency]: plan.loaderVersion },
  };
  return { "modrinth.index.json": JSON.stringify(index, null, 2) };
}

// The newest plugin jar for a server's Minecraft version, or null if there isn't one.
export async function resolvePluginFile(projectId, gameVersion) {
  const versions = await getJson(`${API}/project/${encodeURIComponent(projectId)}/version?loaders=${q(PLUGIN_LOADERS)}&game_versions=${q([gameVersion])}`);
  const version = versions.find(v => v.version_type === "release") ?? versions[0];
  const file = version && (version.files.find(f => f.primary) ?? version.files[0]);
  if (!file || !allowedDownload(file.url) || !/\.jar$/i.test(file.filename)) return null;
  const project = await getJson(`${API}/project/${encodeURIComponent(projectId)}`);
  return { url: file.url, filename: safeFilename(file.filename), title: project.title, versionNumber: version.version_number };
}
