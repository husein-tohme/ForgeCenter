// Small client for the Pterodactyl (or Pelican) game panel API.
// Application API (ptla_ key): users and servers. Client API (ptlc_ key of an admin
// account): power, live resources and console commands for any server.
export const panelEnabled = () => !!(process.env.PTERODACTYL_URL && process.env.PTERODACTYL_APP_KEY
  && process.env.PTERODACTYL_NEST_ID && process.env.PTERODACTYL_EGG_ID && process.env.PTERODACTYL_LOCATION_ID);

export class PanelError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function call(kind, method, path, body) {
  const base = process.env.PTERODACTYL_URL.replace(/\/+$/, "");
  const keyName = kind === "client" ? "PTERODACTYL_CLIENT_KEY" : "PTERODACTYL_APP_KEY";
  if (!process.env[keyName]) throw new PanelError(`${keyName} isn't set.`, 0);
  const r = await fetch(`${base}/api/${kind}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env[keyName]}`,
      Accept: "Application/vnd.pterodactyl.v1+json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return null;
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const detail = data?.errors?.map(e => e.detail).join(" ") || r.statusText;
    throw new PanelError(`Panel ${method} ${path} failed (${r.status}): ${detail}`, r.status);
  }
  return data;
}
const app = (method, path, body) => call("application", method, path, body);
const client = (method, path, body) => call("client", method, path, body);

async function findOrNull(promise) {
  try { return await promise; } catch (e) { if (e.status === 404) return null; throw e; }
}

export async function ensureUser({ externalId, email, username, firstName, lastName }) {
  const found = await findOrNull(app("GET", `/users/external/${encodeURIComponent(externalId)}`));
  if (found) return found.attributes;
  const created = await app("POST", "/users", {
    external_id: externalId, email, username, first_name: firstName || "Player", last_name: lastName || "ForgeCenter",
  });
  return created.attributes;
}

let eggCache;
async function egg() {
  if (eggCache) return eggCache;
  const data = await app("GET", `/nests/${process.env.PTERODACTYL_NEST_ID}/eggs/${process.env.PTERODACTYL_EGG_ID}?include=variables`);
  const a = data.attributes;
  eggCache = {
    dockerImage: a.docker_image || Object.values(a.docker_images ?? {})[0],
    startup: a.startup,
    environment: Object.fromEntries((a.relationships?.variables?.data ?? [])
      .map(v => [v.attributes.env_variable, v.attributes.default_value ?? ""])),
  };
  return eggCache;
}
export const clearPanelCache = () => { eggCache = null; };

// Creates the server once; calling again for the same order returns the existing one.
export async function ensureServer({ externalId, name, userId, limits }) {
  let server = (await findOrNull(app("GET", `/servers/external/${encodeURIComponent(externalId)}`)))?.attributes;
  if (!server) {
    const e = await egg();
    const extra = process.env.PTERODACTYL_STARTUP_EXTRA ? ` ${process.env.PTERODACTYL_STARTUP_EXTRA}` : "";
    server = (await app("POST", "/servers", {
      external_id: externalId, name, user: userId,
      egg: Number(process.env.PTERODACTYL_EGG_ID), docker_image: e.dockerImage, startup: e.startup + extra,
      environment: e.environment,
      limits: { memory: limits.memoryMb, swap: 0, disk: limits.diskMb, io: 500, cpu: limits.cpuPercent },
      feature_limits: { databases: 1, backups: 3, allocations: 1 },
      deploy: { locations: [Number(process.env.PTERODACTYL_LOCATION_ID)], dedicated_ip: false, port_range: [] },
      start_on_completion: true,
    })).attributes;
  }
  const full = (await app("GET", `/servers/${server.id}?include=allocations`)).attributes;
  const allocations = (full.relationships?.allocations?.data ?? []).map(d => d.attributes);
  const alloc = allocations.find(a => a.id === full.allocation) ?? allocations[0];
  const host = process.env.PTERODACTYL_PUBLIC_HOST || alloc?.alias || alloc?.ip;
  return { id: server.id, identifier: server.identifier, address: host && alloc ? `${host}:${alloc.port}` : null };
}

export const suspendServer = id => app("POST", `/servers/${id}/suspend`);
export const unsuspendServer = id => app("POST", `/servers/${id}/unsuspend`);
export async function deleteServer(id) { await findOrNull(app("DELETE", `/servers/${id}`)); }

export const power = (identifier, signal) => client("POST", `/servers/${identifier}/power`, { signal });
export const sendCommand = (identifier, command) => client("POST", `/servers/${identifier}/command`, { command });
export async function resources(identifier) {
  const a = (await client("GET", `/servers/${identifier}/resources`)).attributes;
  return {
    state: a.current_state, suspended: !!a.is_suspended,
    memoryMb: Math.round((a.resources?.memory_bytes ?? 0) / 1048576),
    cpuPercent: Math.round(a.resources?.cpu_absolute ?? 0),
    diskMb: Math.round((a.resources?.disk_bytes ?? 0) / 1048576),
    uptimeSeconds: Math.round((a.resources?.uptime ?? 0) / 1000),
  };
}

// Files on a server (Client API). A missing folder lists as empty.
export async function listFiles(identifier, directory) {
  const data = await findOrNull(client("GET", `/servers/${identifier}/files/list?directory=${encodeURIComponent(directory)}`));
  return (data?.data ?? []).map(f => f.attributes);
}
export const pullFile = (identifier, { url, directory, filename }) =>
  client("POST", `/servers/${identifier}/files/pull`, { url, directory, filename });
export const deleteFiles = (identifier, root, files) =>
  client("POST", `/servers/${identifier}/files/delete`, { root, files });
