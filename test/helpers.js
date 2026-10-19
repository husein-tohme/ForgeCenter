// Shared test setup: an in-memory database, the app on a random port, and helpers to
// sign people in and call the API like the browser does.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";
const { createApp } = await import("../src/app.js");
const { db, now } = await import("../src/db.js");
const { startSession } = await import("../src/auth.js");
export { db };

const server = createApp().listen(0);
await new Promise(r => server.once("listening", r));
export const base = `http://127.0.0.1:${server.address().port}`;
server.unref();

// Makes a finished account (birthday answered, username set) and a session cookie.
export function signIn(username, { age = "adult", email = `${username}@example.com` } = {}) {
  const user = db.prepare("INSERT INTO users (username, name, email, age_group, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *")
    .get(username, username, email, age, now());
  let cookie;
  startSession({ cookie: (_n, token) => { cookie = `fh_session=${token}`; } }, user.id);
  return { user, cookie };
}

export async function api(path, { method = "GET", body, raw, cookie, origin = base, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = cookie;
  if (origin && method !== "GET") h.Origin = origin;
  let payload;
  if (raw !== undefined) { payload = raw; h["Content-Type"] = "application/octet-stream"; }
  else if (body !== undefined) { payload = JSON.stringify(body); h["Content-Type"] = "application/json"; }
  const r = await fetch(base + path, { method, headers: h, body: payload, redirect: "manual" });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, body: json, text, headers: r.headers };
}
