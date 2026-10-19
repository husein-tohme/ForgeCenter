// A repo: browse folders, view and edit files, upload, history, settings.
import { $, api, esc, ago, size, toast, openReport, openSignIn, getUser, onUser } from "./common.js";

const [, owner, name] = location.pathname.split("/").map(decodeURIComponent);
const root = $("repo");
const enc = p => p.split("/").map(encodeURIComponent).join("/");
const IMAGE = /\.(png|jpe?g|gif|webp|ico|bmp)$/i;
let data, tab = "code";

const params = () => new URLSearchParams(location.search);
const go = (path, push = true) => {
  const url = path ? `?path=${encodeURIComponent(path)}` : location.pathname;
  if (push) history.pushState(null, "", url);
  render();
};
window.addEventListener("popstate", () => render());

async function load() {
  const r = await api(`/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
  if (!r.ok) { root.innerHTML = `<div class="empty"><h1>Repo not found</h1><p>${esc(r.data.error)}</p></div>`; return; }
  data = r.data;
  render();
}

function header() {
  const r = data.repo;
  return `<div class="repo-head">
    <h1><a href="/${esc(r.owner)}">${esc(r.owner)}</a> / <a href="/${esc(r.owner)}/${encodeURIComponent(r.name)}"><b>${esc(r.name)}</b></a></h1>
    ${r.private ? `<span class="pill">Private</span>` : `<span class="pill">Public</span>`}
    <span style="flex:1"></span>
    <button class="btn btn-small" id="star" aria-pressed="${data.starred}">${data.starred ? "★ Starred" : "☆ Star"} · ${r.stars}</button>
    ${data.hasSite && !r.private ? `<a class="btn btn-small btn-primary" href="/p/${esc(r.owner)}/${encodeURIComponent(r.name)}/" target="_blank" rel="noopener">▶ Live site</a>` : ""}
    <a class="btn btn-small" href="/zip/${esc(r.owner)}/${encodeURIComponent(r.name)}">Download zip</a>
    ${!data.mine && !r.private ? `<button class="btn btn-small" id="report">Report</button>` : ""}
  </div>
  ${r.description ? `<p class="muted">${esc(r.description)}</p>` : ""}
  <div class="tabs" role="tablist">
    ${["code", "history", ...(data.mine ? ["settings"] : [])].map(t => `<button role="tab" data-tab="${t}" aria-selected="${tab === t}">${{ code: "Code", history: `History (${data.commits.length})`, settings: "Settings" }[t]}</button>`).join("")}
  </div>`;
}

function render() {
  root.innerHTML = header() + `<div id="tab-body"></div>`;
  root.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
  $("star").onclick = star;
  $("report")?.addEventListener("click", () => openReport("repo", `${data.repo.owner}/${data.repo.name}`));
  const body = $("tab-body");
  if (tab === "history") return renderHistory(body);
  if (tab === "settings") return renderSettings(body);
  const path = params().get("path") ?? "";
  if (path && data.files.some(f => f.path === path)) return renderFile(body, path);
  renderFolder(body, path.replace(/\/$/, ""));
}

function crumbs(path) {
  const parts = path ? path.split("/") : [];
  return `<span class="crumbs"><a href="${location.pathname}" data-go="">${esc(data.repo.name)}</a>${parts.map((p, i) =>
    ` / <a href="?path=${encodeURIComponent(parts.slice(0, i + 1).join("/"))}" data-go="${esc(parts.slice(0, i + 1).join("/"))}">${esc(p)}</a>`).join("")}</span>`;
}
const wireGo = el => el.querySelectorAll("[data-go]").forEach(a => a.onclick = e => { e.preventDefault(); go(a.dataset.go); });

function renderFolder(body, folder) {
  const prefix = folder ? `${folder}/` : "";
  const dirs = new Map(), files = [];
  for (const f of data.files) {
    if (!f.path.startsWith(prefix)) continue;
    const rest = f.path.slice(prefix.length);
    if (rest.includes("/")) { const d = rest.split("/")[0]; dirs.set(d, (dirs.get(d) ?? 0) + f.size); }
    else files.push(f);
  }
  if (folder && !dirs.size && !files.length) return go("", false);
  const last = data.commits[0];
  body.innerHTML = `<div class="layout-2"><div>
    <div class="files">
      <div class="files-bar">${crumbs(folder)}<span style="flex:1"></span>
        ${last ? `<span class="small muted">${esc(last.message)} · ${ago(last.at)}</span>` : ""}
        ${data.mine ? `<button class="btn btn-small" id="new-file">+ New file</button>` : ""}</div>
      ${[...dirs].sort().map(([d, n]) => `<a class="file-row" href="?path=${encodeURIComponent(prefix + d)}" data-go="${esc(prefix + d)}"><span aria-hidden="true">📁</span><span>${esc(d)}</span><span class="size">${size(n)}</span></a>`).join("")}
      ${files.map(f => `<a class="file-row" href="?path=${encodeURIComponent(f.path)}" data-go="${esc(f.path)}"><span aria-hidden="true">📄</span><span>${esc(f.path.slice(prefix.length))}</span><span class="size">${size(f.size)}</span></a>`).join("")}
      ${!dirs.size && !files.length ? `<div class="empty">This repo is empty.${data.mine ? " Drop files below to add some." : ""}</div>` : ""}
    </div>
    ${data.mine ? `<div class="dropzone" id="drop"><p><b>Drag files or a folder here</b> to upload${folder ? ` into ${esc(folder)}/` : ""}</p>
      <div class="row" style="justify-content:center"><label class="btn btn-small">Choose files<input type="file" multiple hidden id="pick-files"></label>
      <label class="btn btn-small">Choose folder<input type="file" webkitdirectory hidden id="pick-folder"></label></div>
      <p class="small" id="upload-status">Up to 10 MB a file and 100 MB a repo.</p></div>` : ""}
    ${!folder && data.readme ? `<div class="files" style="margin-top:16px"><div class="files-bar"><b>README</b></div><div class="readme">${esc(data.readme)}</div></div>` : ""}
  </div>
  <aside class="panel"><h2>About</h2><p class="muted">${esc(data.repo.description || "No description yet.")}</p>
    <div class="meta" style="display:grid;gap:6px"><span>${data.files.length} files · ${size(data.totalBytes)}</span><span>★ ${data.repo.stars} stars</span><span>Updated ${ago(data.repo.updatedAt)}</span></div>
    ${data.hasSite && !data.repo.private ? `<p><a href="/p/${esc(owner)}/${encodeURIComponent(name)}/" target="_blank" rel="noopener">Open the live site ↗</a></p>` : ""}
    ${data.mine ? `<p class="small">Selling this? <a href="/store">Add it to the store</a>.</p>` : ""}</aside></div>`;
  wireGo(body);
  if (!data.mine) return;
  $("new-file").onclick = () => {
    const p = prompt("File name (use / for folders):", `${prefix}new-file.txt`);
    if (p) editFile(body, p.trim(), "", true);
  };
  const drop = $("drop");
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = async e => { e.preventDefault(); drop.classList.remove("over"); upload(await droppedFiles(e.dataTransfer), prefix); };
  $("pick-files").onchange = e => upload([...e.target.files].map(f => [f.name, f]), prefix);
  $("pick-folder").onchange = e => upload([...e.target.files].map(f => [f.webkitRelativePath || f.name, f]), prefix);
}

// Folders dropped from the desktop arrive as directory entries; walk them for files.
async function droppedFiles(dt) {
  const out = [];
  const walk = async (entry, dir) => {
    if (entry.isFile) await new Promise(res => entry.file(f => { out.push([dir + f.name, f]); res(); }, res));
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do { batch = await new Promise(res => reader.readEntries(res, () => res([]))); for (const e of batch) await walk(e, `${dir}${entry.name}/`); } while (batch.length);
    }
  };
  const entries = [...dt.items].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dt.files].map(f => [f.name, f]);
  for (const e of entries) await walk(e, "");
  return out;
}

async function upload(list, prefix) {
  list = list.filter(([p]) => !/(^|\/)(\.git|node_modules|\.DS_Store)(\/|$)/.test(p));
  if (!list.length) return;
  const status = $("upload-status");
  const done = [];
  for (const [i, [rel, file]] of list.entries()) {
    status.textContent = `Uploading ${i + 1} of ${list.length}: ${rel}`;
    const path = prefix + rel;
    const r = await api(`/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/file?path=${encodeURIComponent(path)}&commit=0`, { method: "PUT", raw: file });
    if (!r.ok) { toast(`${rel}: ${r.data.error}`); continue; }
    if (!r.data.unchanged) done.push(path);
  }
  if (done.length) await api(`/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commit`, { method: "POST", body: { paths: done, message: done.length === 1 ? `Add ${done[0]}` : `Upload ${done.length} files` } });
  toast(done.length ? `Uploaded ${done.length} file${done.length > 1 ? "s" : ""}.` : "Nothing new to upload.");
  await load();
}

async function renderFile(body, path) {
  const f = data.files.find(x => x.path === path);
  const rawUrl = `/raw/${esc(owner)}/${encodeURIComponent(name)}/${enc(path)}`;
  body.innerHTML = `<div class="files"><div class="files-bar">${crumbs(path)}<span style="flex:1"></span><span class="small muted">${size(f.size)}</span>
    ${data.mine ? `<button class="btn btn-small" id="edit" hidden>Edit</button><button class="btn btn-small btn-danger" id="del">Delete</button>` : ""}
    <a class="btn btn-small" href="${rawUrl}">Download</a></div><div id="file-body"><p class="hint" style="padding:14px">Loading…</p></div></div>`;
  wireGo(body);
  $("del")?.addEventListener("click", async () => {
    if (!confirm(`Delete ${path}?`)) return;
    const r = await api(`/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/file?path=${encodeURIComponent(path)}`, { method: "DELETE" });
    if (!r.ok) return toast(r.data.error);
    toast("Deleted."); history.pushState(null, "", `?path=${encodeURIComponent(path.split("/").slice(0, -1).join("/"))}`); load();
  });
  const fb = $("file-body");
  if (IMAGE.test(path)) {
    const blob = await (await fetch(rawUrl)).blob();
    fb.innerHTML = `<div style="padding:20px;text-align:center"><img alt="${esc(path)}" style="image-rendering:pixelated;max-height:60vh"></div>`;
    fb.querySelector("img").src = URL.createObjectURL(blob.slice(0, blob.size, `image/${path.split(".").pop().toLowerCase().replace("jpg", "jpeg")}`));
    return;
  }
  const r = await api(`/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/file?path=${encodeURIComponent(path)}`);
  if (r.data.text == null) { fb.innerHTML = `<div class="empty">This file can't be shown here. <a href="${rawUrl}">Download it</a>.</div>`; return; }
  fb.innerHTML = `<pre class="code">${r.data.text.split("\n").map(l => `<span class="ln">${esc(l)}</span>`).join("\n")}</pre>`;
  if ($("edit")) { $("edit").hidden = false; $("edit").onclick = () => editFile(body, path, r.data.text, false); }
}

function editFile(body, path, text, isNew) {
  body.innerHTML = `<form class="files" id="edit-form"><div class="files-bar">
      <label class="sr-only" for="edit-path">File path</label><input id="edit-path" value="${esc(path)}" ${isNew ? "" : "readonly"} style="max-width:420px">
      <span style="flex:1"></span><button class="btn btn-small" type="button" id="cancel">Cancel</button></div>
    <label class="sr-only" for="editor">File contents</label><textarea class="editor" id="editor" spellcheck="false"></textarea>
    <div class="files-bar"><label class="sr-only" for="msg">What did you change?</label><input id="msg" placeholder="What did you change? (optional)" style="flex:1"><button class="btn btn-primary">Save</button></div></form>`;
  const ed = $("editor");
  ed.value = text;
  ed.focus();
  // Tab inserts two spaces instead of leaving the editor.
  ed.addEventListener("keydown", e => {
    if (e.key !== "Tab" || e.shiftKey) return;
    e.preventDefault();
    ed.setRangeText("  ", ed.selectionStart, ed.selectionEnd, "end");
  });
  $("cancel").onclick = () => render();
  $("edit-form").onsubmit = async e => {
    e.preventDefault();
    const p = $("edit-path").value.trim();
    const r = await api(`/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/file?path=${encodeURIComponent(p)}&message=${encodeURIComponent($("msg").value)}`,
      { method: "PUT", raw: new Blob([ed.value]) });
    if (!r.ok) return toast(r.data.error);
    toast("Saved.");
    history.pushState(null, "", `?path=${encodeURIComponent(p)}`);
    await load();
  };
}

function renderHistory(body) {
  body.innerHTML = data.commits.length ? `<div class="files">${data.commits.map(c => `<div class="commit"><b>${esc(c.message)}</b>
    <span class="small muted">${c.by ? `@${esc(c.by)}` : "someone"} · ${ago(c.at)} · ${c.changes.length} file${c.changes.length > 1 ? "s" : ""}</span>
    <span class="small mono muted">${c.changes.slice(0, 6).map(ch => `${{ add: "+", edit: "~", delete: "−" }[ch.op]} ${esc(ch.path)}`).join("  ")}${c.changes.length > 6 ? " …" : ""}</span></div>`).join("")}</div>`
    : `<div class="empty">No changes yet.</div>`;
}

function renderSettings(body) {
  const r = data.repo;
  body.innerHTML = `<div class="form" style="max-width:640px">
    <form class="panel form" id="about"><h2>About</h2><label>Description<input name="description" maxlength="200" value="${esc(r.description)}"></label>
      <label class="check"><input type="checkbox" name="private" ${r.private ? "checked" : ""}> Private: only you can see it</label>
      <button class="btn btn-primary">Save</button></form>
    <form class="panel form" id="danger"><h2>Delete this repo</h2><p class="muted">This deletes every file and its history. It can't be undone.</p>
      <label>Type <b>${esc(r.name)}</b> to confirm<input name="confirm" autocomplete="off"></label><button class="btn btn-danger">Delete repo</button></form></div>`;
  $("about").onsubmit = async e => {
    e.preventDefault();
    const x = await api(`/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, { method: "PATCH", body: { description: e.target.description.value, private: e.target.private.checked } });
    if (!x.ok) return toast(x.data.error);
    toast("Saved."); load();
  };
  $("danger").onsubmit = async e => {
    e.preventDefault();
    const x = await api(`/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, { method: "DELETE", body: { confirm: e.target.confirm.value } });
    if (!x.ok) return toast(x.data.error);
    location.assign(`/${owner}`);
  };
}

async function star() {
  if (!getUser()) return openSignIn();
  const r = await api(`/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/star`, { method: "POST" });
  if (!r.ok) return toast(r.data.error);
  data.starred = r.data.starred; data.repo.stars = r.data.stars; render();
}

onUser(() => load());
