import { $, api, esc, toast } from "./common.js";

const N = 16;
const PALETTE = [
  "#000000", "#3f3f3f", "#7f7f7f", "#c6c6c6", "#ffffff", "#5a3416", "#8b5a2b", "#c9a46a",
  "#b3261e", "#e8772e", "#f2c230", "#fff27a", "#1e6b2a", "#5da33a", "#3bd16f", "#1f9da6",
  "#4ee2ec", "#2546a8", "#3b7bd6", "#5b3a91", "#9b6fd9", "#d94f9a", "#f5b0cf", "#6e4320",
];
const STORE = "fc-texture-forge";

const canvas = $("canvas");
const ctx = canvas.getContext("2d");
const CELL = canvas.width / N;

let pixels = new Array(N * N).fill(null); // "#rrggbb" or null for transparent
let tool = "pencil";
let color = "#4ee2ec";
let mirror = false;
let cursor = null; // keyboard cursor {x, y}
let drawing = false;
const undoStack = [];
const pack = new Map(); // target -> pixels

const label = target => {
  const [kind, name] = target.split("/");
  const words = name.replace(/_/g, " ");
  return `${words[0].toUpperCase()}${words.slice(1)} (${kind})`;
};

// ---------- Drawing ----------
function render() {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = pixels[y * N + x];
    if (c) { ctx.fillStyle = c; ctx.fillRect(x * CELL, y * CELL, CELL, CELL); }
    else {
      ctx.fillStyle = (x + y) % 2 ? "#d9d9d9" : "#f2f2f2";
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }
  ctx.strokeStyle = "rgba(0,0,0,.12)"; ctx.lineWidth = 1;
  for (let i = 1; i < N; i++) {
    ctx.beginPath(); ctx.moveTo(i * CELL + .5, 0); ctx.lineTo(i * CELL + .5, canvas.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * CELL + .5); ctx.lineTo(canvas.width, i * CELL + .5); ctx.stroke();
  }
  if (mirror) {
    ctx.strokeStyle = "rgba(37,70,168,.6)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(canvas.width / 2, 0); ctx.lineTo(canvas.width / 2, canvas.height); ctx.stroke();
  }
  if (cursor) {
    ctx.strokeStyle = "#f2c230"; ctx.lineWidth = 3;
    ctx.strokeRect(cursor.x * CELL + 1.5, cursor.y * CELL + 1.5, CELL - 3, CELL - 3);
  }
  const png = toPng();
  $("preview-small").src = png;
  $("preview-big").src = png;
  save();
}

function toPng(src = pixels) {
  const off = document.createElement("canvas");
  off.width = off.height = N;
  const o = off.getContext("2d");
  const img = o.createImageData(N, N);
  src.forEach((c, i) => {
    if (!c) return;
    img.data[i * 4] = parseInt(c.slice(1, 3), 16);
    img.data[i * 4 + 1] = parseInt(c.slice(3, 5), 16);
    img.data[i * 4 + 2] = parseInt(c.slice(5, 7), 16);
    img.data[i * 4 + 3] = 255;
  });
  o.putImageData(img, 0, 0);
  return off.toDataURL("image/png");
}

function pushUndo() {
  undoStack.push(pixels.slice());
  if (undoStack.length > 60) undoStack.shift();
}

function fill(x, y, value) {
  const start = pixels[y * N + x];
  if (start === value) return;
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= N || cy >= N || pixels[cy * N + cx] !== start) continue;
    pixels[cy * N + cx] = value;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
}

function apply(x, y) {
  if (tool === "picker") {
    const c = pixels[y * N + x];
    if (c) setColor(c);
    setTool("pencil");
    return;
  }
  const value = tool === "eraser" ? null : color;
  const spots = mirror ? [[x, y], [N - 1 - x, y]] : [[x, y]];
  for (const [sx, sy] of spots) {
    if (tool === "fill") fill(sx, sy, value); else pixels[sy * N + sx] = value;
  }
  render();
}

function cellFromEvent(e) {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * N);
  const y = Math.floor(((e.clientY - r.top) / r.height) * N);
  return x >= 0 && y >= 0 && x < N && y < N ? { x, y } : null;
}

canvas.addEventListener("pointerdown", e => {
  const cell = cellFromEvent(e); if (!cell) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  cursor = null;
  pushUndo();
  drawing = tool === "pencil" || tool === "eraser";
  apply(cell.x, cell.y);
});
canvas.addEventListener("pointermove", e => {
  if (!drawing) return;
  const cell = cellFromEvent(e);
  if (cell) apply(cell.x, cell.y);
});
canvas.addEventListener("pointerup", () => { drawing = false; });
canvas.addEventListener("pointercancel", () => { drawing = false; });

// Keyboard drawing: arrows move, Space or Enter uses the current tool.
canvas.addEventListener("keydown", e => {
  const moves = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  if (moves[e.key]) {
    e.preventDefault();
    cursor ??= { x: 7, y: 7 };
    cursor = { x: Math.min(N - 1, Math.max(0, cursor.x + moves[e.key][0])), y: Math.min(N - 1, Math.max(0, cursor.y + moves[e.key][1])) };
    render();
  } else if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    cursor ??= { x: 7, y: 7 };
    pushUndo(); apply(cursor.x, cursor.y);
  } else if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undo(); }
});
canvas.addEventListener("focus", () => { cursor ??= { x: 7, y: 7 }; render(); });
canvas.addEventListener("blur", () => { cursor = null; render(); });

// ---------- Tools and colours ----------
function setTool(t) {
  tool = t;
  document.querySelectorAll("[data-tool]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tool === t)));
}
document.querySelectorAll("[data-tool]").forEach(b => b.addEventListener("click", () => setTool(b.dataset.tool)));
$("mirror").addEventListener("click", e => { mirror = !mirror; e.target.setAttribute("aria-pressed", String(mirror)); render(); });
function undo() { if (undoStack.length) { pixels = undoStack.pop(); render(); } }
$("undo").addEventListener("click", undo);
$("clear").addEventListener("click", () => { pushUndo(); pixels.fill(null); render(); });

function setColor(c) {
  color = c.toLowerCase();
  $("color").value = color;
  document.querySelectorAll(".swatch").forEach(s => s.setAttribute("aria-pressed", String(s.dataset.color === color)));
  if (tool === "eraser") setTool("pencil");
}
$("palette").innerHTML = PALETTE.map(c =>
  `<button type="button" class="swatch" data-color="${c}" aria-pressed="false" aria-label="Colour ${c}" style="background:${c}"></button>`).join("");
$("palette").addEventListener("click", e => { const s = e.target.closest(".swatch"); if (s) setColor(s.dataset.color); });
$("color").addEventListener("input", e => setColor(e.target.value));

// ---------- Pack ----------
function renderPack() {
  const list = $("pack-list");
  if (!pack.size) {
    list.innerHTML = `<li class="hint">No textures yet. Draw something, choose what it replaces, then add it to the pack.</li>`;
  } else {
    list.innerHTML = [...pack].map(([target, px]) => `
      <li class="pack-item">
        <button type="button" class="pack-thumb" data-edit="${target}" aria-label="Edit ${esc(label(target))}"><img src="${toPng(px)}" alt=""></button>
        <span>${esc(label(target))}</span>
        <button type="button" class="btn btn-small" data-remove="${target}">Remove</button>
      </li>`).join("");
  }
  $("add").textContent = pack.has($("target").value) ? "Update in pack" : "Add to pack";
  save();
}

$("add").addEventListener("click", () => {
  if (pixels.every(p => p === null)) return toast("Draw something first.");
  const target = $("target").value;
  const updating = pack.has(target);
  pack.set(target, pixels.slice());
  renderPack();
  toast(updating ? `Updated ${label(target)}.` : `Added ${label(target)} to the pack.`);
});
$("target").addEventListener("change", renderPack);
$("pack-list").addEventListener("click", e => {
  const edit = e.target.closest("[data-edit]");
  const remove = e.target.closest("[data-remove]");
  if (edit) {
    pushUndo();
    pixels = pack.get(edit.dataset.edit).slice();
    $("target").value = edit.dataset.edit;
    render(); renderPack();
    canvas.focus();
  } else if (remove) {
    pack.delete(remove.dataset.remove);
    renderPack();
  }
});

$("pack-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (!pack.size) return toast("Add at least one texture to the pack first.");
  const f = new FormData(e.target);
  const body = {
    name: f.get("name").trim() || "My Texture Pack", description: f.get("description").trim(), gameVersion: f.get("gameVersion"),
    textures: [...pack].map(([target, px]) => ({ target, png: toPng(px) })),
  };
  $("download").disabled = true;
  const r = await fetch("/api/texturepack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  $("download").disabled = false;
  if (!r.ok) return toast((await r.json().catch(() => ({}))).error || "The pack couldn't be made. Try again.");
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(await r.blob()), download: `${body.name.replace(/\W+/g, "-")}.zip` });
  a.click();
  toast("Resource pack downloaded.");
});

// ---------- Remember the work in progress on this device ----------
function save() {
  try { localStorage.setItem(STORE, JSON.stringify({ pixels, pack: [...pack] })); } catch {}
}
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "null");
    const valid = a => Array.isArray(a) && a.length === N * N && a.every(c => c === null || /^#[0-9a-f]{6}$/.test(c));
    if (valid(saved?.pixels)) pixels = saved.pixels;
    for (const [t, px] of saved?.pack ?? []) if (typeof t === "string" && valid(px)) pack.set(t, px);
  } catch {}
}

// ---------- Start ----------
const options = await api("/api/texturepack/options");
if (options.ok) {
  const { targets, versions } = options.data;
  $("target").innerHTML = Object.entries(targets).map(([kind, names]) =>
    `<optgroup label="${kind === "item" ? "Items" : "Blocks"}">${names.map(n =>
      `<option value="${kind}/${n}">${esc(label(`${kind}/${n}`).replace(/ \(.*\)$/, ""))}</option>`).join("")}</optgroup>`).join("");
  $("version").innerHTML = versions.map(v => `<option value="${v}">${v}</option>`).join("");
  $("version").value = options.data.recommended && versions.includes(options.data.recommended) ? options.data.recommended : versions[0];
} else toast("Texture Forge couldn't load. Refresh the page to try again.");
restore();
setColor(color);
render();
renderPack();
