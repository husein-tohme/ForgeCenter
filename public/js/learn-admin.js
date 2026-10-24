// CodeHub owner page: tracks, lessons, code files, clips and clip-to-code links.
// Everything goes through the owner routes in src/learn.js.
import { $, api, esc, toast, onUser, openSignIn } from "./common.js";

const LEVEL_NAMES = { beginner: "Just started", hobby: "Hobby coder", pro: "Professional", expert: "Expert" };
let tracks = [], trackId = null, track = null, lessonId = null, lesson = null, loaded = false;

$("signin-here").addEventListener("click", () => openSignIn());
onUser(user => {
  const ok = !!user?.isAdmin;
  $("panel").hidden = !ok;
  $("denied").hidden = ok;
  if (user && !ok) {
    $("denied-text").textContent = "This account isn't the site owner's. Only the owner can manage CodeHub lessons.";
    $("signin-here").hidden = true;
  }
  if (ok && !loaded) { loaded = true; loadTracks(); }
});

// "1:05", "65" or "1:02:03" → seconds; null when it isn't a time.
export function toSeconds(value) {
  const t = String(value ?? "").trim();
  if (!/^\d{1,5}(:[0-5]?\d){0,2}$/.test(t)) return null;
  return t.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}
const clock = s => {
  if (s === null || s === undefined) return "";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};
const statusPill = s => `<span class="pill ${s === "published" || s === "live" ? "pill-done" : "pill-muted"}">${s === "published" ? "Published" : s === "live" ? "Live" : s === "hidden" ? "Hidden" : "Draft"}</span>`;
const options = (map, current) => Object.entries(map).map(([v, name]) => `<option value="${v}"${v === current ? " selected" : ""}>${esc(name)}</option>`).join("");
const fields = form => Object.fromEntries(new FormData(form));

// Sends a change and reports the error, if any. Returns the answer's data, or null.
async function send(path, method, body) {
  const r = await api(path, { method, body });
  if (!r.ok) { toast(r.data.error || "That didn't work. Try again."); return null; }
  return r.data;
}

// ---------- Tracks ----------
async function loadTracks() {
  const r = await api("/api/admin/learn/tracks");
  if (!r.ok) { $("tracks").innerHTML = `<p class="error">${esc(r.data.error)}</p>`; return; }
  tracks = r.data.tracks;
  renderTracks();
}

function renderTracks() {
  $("tracks").innerHTML = tracks.length ? `<ul class="la-list">${tracks.map(t => `
    <li><button type="button" data-track="${t.id}" aria-current="${t.id === trackId}">
      <span>${esc(t.title)} <span class="small">${t.lessons} ${t.lessons === 1 ? "lesson" : "lessons"}</span></span>${statusPill(t.status)}
    </button></li>`).join("")}</ul>` : `<p class="hint">No tracks yet.</p>`;
  $("tracks").querySelectorAll("[data-track]").forEach(b => b.addEventListener("click", () => openTrack(Number(b.dataset.track))));
}

$("new-track").addEventListener("submit", async e => {
  e.preventDefault();
  const data = await send("/api/admin/learn/tracks", "POST", fields(e.target));
  if (!data) return;
  e.target.reset();
  await loadTracks();
  openTrack(data.track.id);
});

async function openTrack(id) {
  trackId = id; lessonId = null; lesson = null;
  $("lesson-editor").innerHTML = "";
  renderTracks();
  const slug = tracks.find(t => t.id === id)?.slug;
  const r = await api(`/api/learn/tracks/${encodeURIComponent(slug)}`);
  if (!r.ok) { $("track-editor").innerHTML = `<p class="error">${esc(r.data.error)}</p>`; return; }
  track = r.data;
  renderTrack();
}

function renderTrack() {
  const t = track.track;
  $("track-editor").innerHTML = `
    <h2>${esc(t.title)}</h2>
    <form class="panel form" id="track-form" novalidate>
      <div class="la-grid">
        <label>Title<input name="title" maxlength="120" value="${esc(t.title)}" required></label>
        <label>Web address<input name="slug" maxlength="60" value="${esc(t.slug)}" spellcheck="false"></label>
        <label class="wide">Summary<input name="summary" maxlength="300" value="${esc(t.summary)}"></label>
        <label>Level<select name="level">${options(LEVEL_NAMES, t.level)}</select></label>
        <label>Language<input name="language" maxlength="40" value="${esc(t.language)}" placeholder="python"></label>
        <label class="wide">What to expect<textarea name="expect" rows="3" maxlength="3000">${esc(t.expect)}</textarea></label>
        <label class="wide">How to study it<textarea name="study" rows="3" maxlength="3000">${esc(t.study)}</textarea></label>
        <label class="wide">What you'll make<textarea name="make" rows="3" maxlength="3000">${esc(t.make)}</textarea></label>
        <label>Status<select name="status">${options({ draft: "Draft", published: "Published" }, t.status)}</select></label>
        <label>Position<input name="position" type="number" min="0" value="${t.position}"></label>
      </div>
      <div class="la-actions">
        <button class="btn btn-buy" type="submit">Save track</button>
        <button class="btn btn-danger" type="button" id="delete-track">Delete track</button>
      </div>
    </form>
    <div class="la-block">
      <h3>Lessons</h3>
      ${track.lessons.length ? `<ul class="la-list">${track.lessons.map(l => `
        <li><button type="button" data-lesson="${l.id}" aria-current="${l.id === lessonId}">
          <span>${esc(l.title)}</span>${statusPill(l.status)}</button></li>`).join("")}</ul>` : `<p class="hint">No lessons yet.</p>`}
      <form class="la-actions" id="new-lesson" novalidate>
        <label class="sr-only" for="new-lesson-title">New lesson title</label>
        <input id="new-lesson-title" name="title" maxlength="120" required autocomplete="off" placeholder="New lesson title">
        <button class="btn" type="submit">Add lesson</button>
      </form>
    </div>`;

  $("track-form").addEventListener("submit", async e => {
    e.preventDefault();
    const body = fields(e.target);
    body.position = Number(body.position);
    const data = await send(`/api/admin/learn/tracks/${t.id}`, "PATCH", body);
    if (!data) return;
    toast("Track saved.");
    await loadTracks();
    openTrack(t.id);
  });
  $("delete-track").addEventListener("click", async () => {
    if (!confirm(`Delete "${t.title}" and all its lessons, code and clips? This can't be undone.`)) return;
    if (!await send(`/api/admin/learn/tracks/${t.id}`, "DELETE")) return;
    trackId = null; track = null;
    $("track-editor").innerHTML = `<p class="hint">Track deleted.</p>`;
    $("lesson-editor").innerHTML = "";
    loadTracks();
  });
  $("new-lesson").addEventListener("submit", async e => {
    e.preventDefault();
    const data = await send(`/api/admin/learn/tracks/${t.id}/lessons`, "POST", fields(e.target));
    if (!data) return;
    await loadTracks();
    await openTrack(t.id);
    openLesson(data.lesson.id);
  });
  $("track-editor").querySelectorAll("[data-lesson]").forEach(b => b.addEventListener("click", () => openLesson(Number(b.dataset.lesson))));
}

// ---------- Lessons ----------
async function openLesson(id) {
  lessonId = id;
  $("track-editor").querySelectorAll("[data-lesson]").forEach(b => b.setAttribute("aria-current", String(Number(b.dataset.lesson) === id)));
  const r = await api(`/api/learn/lessons/${id}`);
  if (!r.ok) { $("lesson-editor").innerHTML = `<p class="error">${esc(r.data.error)}</p>`; return; }
  showLesson(r.data);
}

// Every lesson change answers with the whole lesson, so the page redraws from that.
function showLesson(data) {
  lesson = data;
  renderLesson();
}

function renderLesson() {
  const l = lesson.lesson;
  $("lesson-editor").innerHTML = `
    <h2>${esc(l.title)}</h2>
    <form class="panel form" id="lesson-form" novalidate>
      <div class="la-grid">
        <label>Title<input name="title" maxlength="120" value="${esc(l.title)}" required></label>
        <label>Web address<input name="slug" maxlength="60" value="${esc(l.slug)}" spellcheck="false"></label>
        <label class="wide">Summary<input name="summary" maxlength="300" value="${esc(l.summary)}"></label>
        <label class="wide">Lesson text<textarea name="body" rows="8" maxlength="50000">${esc(l.body)}</textarea></label>
        <label>Status<select name="status">${options({ draft: "Draft", published: "Published" }, l.status)}</select></label>
        <label>Position<input name="position" type="number" min="0" value="${l.position}"></label>
      </div>
      <div class="la-actions">
        <button class="btn btn-buy" type="submit">Save lesson</button>
        <a class="btn" href="/learn/lesson?id=${l.id}" target="_blank" rel="noopener">Preview</a>
        <button class="btn btn-danger" type="button" id="delete-lesson">Delete lesson</button>
      </div>
    </form>

    <div class="la-block">
      <h3>Code</h3>
      ${lesson.files.map(fileItem).join("") || `<p class="hint">No code yet. Add the file the video explains.</p>`}
      <details class="la-item" data-key="new-file"${lesson.files.length ? "" : " open"}>
        <summary>Add a file</summary>
        <form class="form" id="new-file" novalidate>
          <div class="la-grid">
            <label>File name<input name="path" maxlength="200" required spellcheck="false" placeholder="main.py"></label>
            <label>Language<input name="language" maxlength="40" spellcheck="false" placeholder="python"></label>
            <label class="wide">Code<textarea class="la-code" name="content" spellcheck="false"></textarea></label>
          </div>
          <button class="btn btn-buy" type="submit">Add file</button>
        </form>
      </details>
    </div>

    <div class="la-block">
      <h3>Clips</h3>
      <p class="small">Paste a YouTube link (Shorts too). Clips play only through YouTube's own player, so creators keep their views.</p>
      ${lesson.clips.map(clipItem).join("") || `<p class="hint">No clips yet.</p>`}
      <details class="la-item" data-key="new-clip"${lesson.clips.length ? "" : " open"}>
        <summary>Add a clip</summary>
        <form class="form" id="new-clip" novalidate>
          <div class="la-grid">
            <label class="wide">YouTube link<input name="video" maxlength="300" required spellcheck="false" placeholder="https://www.youtube.com/watch?v=…"></label>
            <label class="wide">Video title<input name="title" maxlength="200" required></label>
            <label>Channel name<input name="channelName" maxlength="100"></label>
            <label>Channel link<input name="channelUrl" maxlength="300" spellcheck="false" placeholder="https://www.youtube.com/@…"></label>
            <label>Starts at<input name="start" placeholder="0:00" inputmode="numeric"></label>
            <label>Ends at <span class="optional">(optional)</span><input name="end" placeholder="5:30" inputmode="numeric"></label>
          </div>
          <button class="btn btn-buy" type="submit">Add clip</button>
        </form>
      </details>
    </div>`;

  wireLesson();
}

const fileItem = f => `
  <details class="la-item" data-key="file-${f.id}">
    <summary>${esc(f.path)} <span class="small">${f.lines} ${f.lines === 1 ? "line" : "lines"}</span></summary>
    <form class="form" data-file="${f.id}" novalidate>
      <div class="la-grid">
        <label>File name<input name="path" maxlength="200" value="${esc(f.path)}" spellcheck="false"></label>
        <label>Language<input name="language" maxlength="40" value="${esc(f.language)}" spellcheck="false"></label>
        <label class="wide">Code<textarea class="la-code" name="content" spellcheck="false">${esc(f.content)}</textarea></label>
      </div>
      <div class="la-actions">
        <button class="btn btn-buy" type="submit">Save file</button>
        <button class="btn btn-danger" type="button" data-delete-file="${f.id}">Delete file</button>
      </div>
    </form>
  </details>`;

function clipItem(c) {
  const fileName = id => lesson.files.find(f => f.id === id)?.path ?? "a deleted file";
  return `
  <details class="la-item" data-key="clip-${c.id}">
    <summary>${esc(c.title)} ${statusPill(c.status)} ${c.form === "short" ? `<span class="pill pill-info">Quick clip</span>` : ""}
      <span class="small">${clock(c.start)}${c.end !== null ? `–${clock(c.end)}` : " onwards"} · ${c.links.length} code ${c.links.length === 1 ? "link" : "links"}</span></summary>
    <form class="form" data-clip="${c.id}" novalidate>
      <p class="small"><a href="https://www.youtube.com/watch?v=${esc(c.youtubeId)}&t=${c.start}s" target="_blank" rel="noopener">Watch on YouTube</a></p>
      <div class="la-grid">
        <label class="wide">Video title<input name="title" maxlength="200" value="${esc(c.title)}"></label>
        <label>Channel name<input name="channelName" maxlength="100" value="${esc(c.channelName)}"></label>
        <label>Channel link<input name="channelUrl" maxlength="300" value="${esc(c.channelUrl ?? "")}" spellcheck="false"></label>
        <label>Starts at<input name="start" value="${clock(c.start)}" inputmode="numeric"></label>
        <label>Ends at <span class="optional">(optional)</span><input name="end" value="${clock(c.end)}" inputmode="numeric"></label>
        <label>Kind<select name="form">${options({ long: "Lesson video", short: "Quick clip (under 5 minutes)" }, c.form)}</select></label>
        <label>Status<select name="status">${options({ live: "Live", hidden: "Hidden" }, c.status)}</select></label>
      </div>
      <div class="la-actions">
        <button class="btn btn-buy" type="submit">Save clip</button>
        <button class="btn btn-danger" type="button" data-delete-clip="${c.id}">Delete clip</button>
      </div>
    </form>
    <div class="form">
      <h4>Code links</h4>
      <p class="small">Say which lines this clip explains, and when. While the video plays, those lines light up.</p>
      ${c.links.length ? `<table class="la-links"><thead><tr><th>When</th><th>File</th><th>Lines</th><th>Note</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
        ${c.links.map(k => `<tr><td>${clock(k.start)}–${clock(k.end)}</td><td>${esc(fileName(k.fileId))}</td><td>${k.lines[0]}–${k.lines[1]}</td>
          <td>${esc(k.note)}</td><td><button class="btn btn-small" type="button" data-delete-link="${k.id}">Delete</button></td></tr>`).join("")}
      </tbody></table>` : ""}
      ${lesson.files.length ? `<form data-new-link="${c.id}" novalidate>
        <div class="la-times">
          <label>From<input name="start" placeholder="${clock(c.start)}" inputmode="numeric" required></label>
          <label>To<input name="end" placeholder="${clock(c.start + 30)}" inputmode="numeric" required></label>
          <label>First line<input name="from" type="number" min="1" required></label>
          <label>Last line<input name="to" type="number" min="1" required></label>
        </div>
        <div class="la-grid">
          <label>File<select name="fileId">${lesson.files.map(f => `<option value="${f.id}">${esc(f.path)}</option>`).join("")}</select></label>
          <label>Note <span class="optional">(optional)</span><input name="note" maxlength="200"></label>
        </div>
        <button class="btn" type="submit">Add code link</button>
      </form>` : `<p class="hint">Add a code file first.</p>`}
    </div>
  </details>`;
}

// Reads a time field. Empty gives `empty`; a bad time stops the save with a message.
function timeField(value, label, empty) {
  if (String(value ?? "").trim() === "") return empty;
  const s = toSeconds(value);
  if (s === null) throw new Error(`${label} should look like 1:05 (minutes and seconds).`);
  return s;
}

function wireLesson() {
  const l = lesson.lesson;
  const root = $("lesson-editor");
  // Runs a save that may stop on a bad time. Sections that were open stay open, matched
  // by what they hold (a file or clip id), since the redraw can add or remove sections.
  const act = async fn => {
    const open = new Set([...root.querySelectorAll("details[data-key]")].filter(d => d.open).map(d => d.dataset.key));
    let data;
    try { data = await fn(); } catch (e) { toast(e.message); return; }
    if (!data) return;
    showLesson(data);
    root.querySelectorAll("details[data-key]").forEach(d => { if (open.has(d.dataset.key)) d.open = true; });
  };

  // Saving can change the title or status shown in the track's lesson list, so both redraw.
  $("lesson-form").addEventListener("submit", async e => {
    e.preventDefault();
    const body = fields(e.target);
    body.position = Number(body.position);
    if (!await send(`/api/admin/learn/lessons/${l.id}`, "PATCH", body)) return;
    toast("Lesson saved.");
    await openTrack(trackId);
    openLesson(l.id);
  });
  $("delete-lesson").addEventListener("click", async () => {
    if (!confirm(`Delete "${l.title}" with its code and clips? This can't be undone.`)) return;
    if (!await send(`/api/admin/learn/lessons/${l.id}`, "DELETE")) return;
    $("lesson-editor").innerHTML = "";
    await loadTracks();
    openTrack(trackId);
  });

  $("new-file").addEventListener("submit", e => {
    e.preventDefault();
    act(() => send(`/api/admin/learn/lessons/${l.id}/files`, "POST", fields(e.target)));
  });
  root.querySelectorAll("[data-file]").forEach(form => form.addEventListener("submit", e => {
    e.preventDefault();
    act(() => send(`/api/admin/learn/files/${form.dataset.file}`, "PATCH", fields(form)));
  }));
  root.querySelectorAll("[data-delete-file]").forEach(b => b.addEventListener("click", () => {
    if (confirm("Delete this file and its code links?")) act(() => send(`/api/admin/learn/files/${b.dataset.deleteFile}`, "DELETE"));
  }));

  $("new-clip").addEventListener("submit", e => {
    e.preventDefault();
    const f = fields(e.target);
    act(() => send(`/api/admin/learn/lessons/${l.id}/clips`, "POST", {
      ...f, start: timeField(f.start, "Starts at", 0), end: timeField(f.end, "Ends at", null),
    }));
  });
  root.querySelectorAll("[data-clip]").forEach(form => form.addEventListener("submit", e => {
    e.preventDefault();
    const f = fields(form);
    act(() => send(`/api/admin/learn/clips/${form.dataset.clip}`, "PATCH", {
      ...f, start: timeField(f.start, "Starts at", 0), end: timeField(f.end, "Ends at", null),
    }));
  }));
  root.querySelectorAll("[data-delete-clip]").forEach(b => b.addEventListener("click", () => {
    if (confirm("Delete this clip and its code links?")) act(() => send(`/api/admin/learn/clips/${b.dataset.deleteClip}`, "DELETE"));
  }));

  root.querySelectorAll("[data-new-link]").forEach(form => form.addEventListener("submit", e => {
    e.preventDefault();
    const f = fields(form);
    act(() => send(`/api/admin/learn/clips/${form.dataset.newLink}/links`, "POST", {
      fileId: Number(f.fileId), note: f.note,
      start: timeField(f.start, "From", null) ?? (() => { throw new Error("Add when the link starts, like 1:05."); })(),
      end: timeField(f.end, "To", null) ?? (() => { throw new Error("Add when the link ends, like 1:30."); })(),
      lines: [Number(f.from), Number(f.to)],
    }));
  }));
  root.querySelectorAll("[data-delete-link]").forEach(b => b.addEventListener("click", () =>
    act(() => send(`/api/admin/learn/links/${b.dataset.deleteLink}`, "DELETE"))));
}
