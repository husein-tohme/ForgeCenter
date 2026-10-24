// A CodeHub lesson (/learn/lesson?id=): a YouTube clip, the code it explains, and the
// lines lighting up as the video reaches them. The whole lesson, links included, loads
// once, so nothing is fetched while the video plays.
import { $, api, esc } from "./common.js";
import { reportButton } from "./report.js";

let lesson, clip, fileId, player = null, ticker = null, liveKey = "";

function showLesson() {
  const { lesson: l, track } = lesson;
  document.title = `${l.title} · ${track.title} · ForgeCenter`;
  $("crumbs").innerHTML = `<a href="/learn">CodeHub</a> <span aria-hidden="true">›</span> <span>${esc(track.title)}</span>`;
  $("lesson-title").textContent = l.title;
  if (l.summary) { $("lesson-summary").textContent = l.summary; $("lesson-summary").hidden = false; }
  $("lesson").hidden = false;

  // Lesson text: blank lines start a new paragraph.
  $("body").innerHTML = l.body.split(/\n\s*\n/).filter(p => p.trim()).map(p => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("");
  $("steps").innerHTML = [
    lesson.previous ? `<a class="btn" href="/learn/lesson?id=${lesson.previous.id}">← ${esc(lesson.previous.title)}</a>` : "<span></span>",
    lesson.next ? `<a class="btn btn-buy" href="/learn/lesson?id=${lesson.next.id}">Next: ${esc(lesson.next.title)} →</a>` : "",
  ].join("");

  if (lesson.files.length) showFile(lesson.files[0].id);
  else $("lines").innerHTML = `<p class="hint">This lesson has no code to show.</p>`;
  $("files").innerHTML = lesson.files.length > 1 ? lesson.files.map(f =>
    `<button type="button" role="tab" data-file="${f.id}">${esc(f.path)}</button>`).join("") : "";
  $("files").querySelectorAll("[data-file]").forEach(b => b.addEventListener("click", () => showFile(Number(b.dataset.file))));

  if (!lesson.clips.length) { document.querySelector(".ll-player").hidden = true; return; }
  if (lesson.clips.length > 1) {
    $("clips").hidden = false;
    $("clips").innerHTML = lesson.clips.map((c, i) => `<button class="chip" type="button" data-clip="${c.id}">Video ${i + 1}: ${esc(c.title)}</button>`).join("");
    $("clips").querySelectorAll("[data-clip]").forEach(b => b.addEventListener("click", () => playClip(Number(b.dataset.clip), { autoplay: true })));
  }
  playClip(lesson.clips[0].id);
  loadPlayer();
}

// ---------- Code ----------
const linesOf = f => f.content === "" ? [] : f.content.split("\n");
const clipLinks = () => clip?.links ?? [];

function showFile(fid) {
  fileId = fid;
  const f = lesson.files.find(x => x.id === fid);
  $("files").querySelectorAll("[data-file]").forEach(b => b.setAttribute("aria-selected", String(Number(b.dataset.file) === fid)));
  // Lines a clip moment explains get a play button that jumps the video there.
  const starts = new Map();
  for (const k of clipLinks()) if (k.fileId === fid && !starts.has(k.lines[0])) starts.set(k.lines[0], k);
  $("lines").innerHTML = `<p class="ll-path">${esc(f.path)}</p><ol class="ll-ol">${linesOf(f).map((text, i) => {
    const k = starts.get(i + 1);
    return `<li id="line-${i + 1}" data-line="${i + 1}">${k
      ? `<button class="ll-jump" type="button" data-seek="${k.id}" title="Play the part about lines ${k.lines[0]}–${k.lines[1]}" aria-label="Play the part of the video about lines ${k.lines[0]} to ${k.lines[1]}">▶</button>`
      : `<span class="ll-gap"></span>`}<code>${esc(text) || " "}</code></li>`;
  }).join("")}</ol>`;
  $("lines").querySelectorAll("[data-seek]").forEach(b => b.addEventListener("click", () => {
    const k = clipLinks().find(x => x.id === Number(b.dataset.seek));
    if (k) seek(k.start);
  }));
  liveKey = "";
  highlight(currentTime());
}

// Lights up the lines the video is explaining right now.
function highlight(t) {
  const live = t === null ? [] : clipLinks().filter(k => t >= k.start && t < k.end);
  const key = live.map(k => k.id).join(",");
  if (key === liveKey) return;
  liveKey = key;
  if (live.length && !live.some(k => k.fileId === fileId)) { showFile(live[0].fileId); return; }
  $("lines").querySelectorAll(".is-live").forEach(li => li.classList.remove("is-live"));
  const here = live.filter(k => k.fileId === fileId);
  for (const k of here) for (let n = k.lines[0]; n <= k.lines[1]; n++) $(`line-${n}`)?.classList.add("is-live");
  const first = here.length && $(`line-${Math.min(...here.map(k => k.lines[0]))}`);
  if (first) {
    const box = $("lines");
    const top = first.offsetTop - box.offsetTop - box.clientHeight / 3;
    box.scrollTo({ top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  const path = f => lesson.files.find(x => x.id === f)?.path ?? "";
  $("now").textContent = here.length
    ? `Now explaining: ${here.map(k => `${path(k.fileId)}, lines ${k.lines[0]}–${k.lines[1]}${k.note ? ` (${k.note})` : ""}`).join("; ")}`
    : "";
}

// ---------- Video ----------
function playClip(cid, { autoplay = false } = {}) {
  clip = lesson.clips.find(c => c.id === cid);
  $("clips").querySelectorAll("[data-clip]").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.clip) === cid)));
  const yt = `https://www.youtube.com/watch?v=${encodeURIComponent(clip.youtubeId)}&t=${clip.start}s`;
  $("credit").innerHTML = `From ${clip.channelUrl ? `<a href="${esc(clip.channelUrl)}" target="_blank" rel="noopener">${esc(clip.channelName || "the creator")}</a>`
    : esc(clip.channelName || "the creator")} on YouTube · <a href="${yt}" target="_blank" rel="noopener">Watch on YouTube</a> · ${reportButton("clip", clip.id)}`;
  // Stay on the open file if this clip explains it; otherwise open the first file it explains.
  const keep = !clipLinks().length || clipLinks().some(k => k.fileId === fileId);
  if (fileId) showFile(keep ? fileId : clipLinks()[0].fileId);
  if (player?.cueVideoById) {
    const args = { videoId: clip.youtubeId, startSeconds: clip.start, ...(clip.end !== null ? { endSeconds: clip.end } : {}) };
    autoplay ? player.loadVideoById(args) : player.cueVideoById(args);
  }
}

function seek(seconds) {
  if (!player?.seekTo) return;
  player.seekTo(seconds, true);
  player.playVideo();
}

const currentTime = () => (player?.getCurrentTime ? player.getCurrentTime() : null);

// YouTube's own player, from youtube-nocookie.com. If it can't load (blocked or offline),
// the page still shows the code and a link to watch on YouTube.
function loadPlayer() {
  const fallback = setTimeout(() => {
    if (player) return;
    $("player").innerHTML = `<p class="hint">The video player didn't load. <a href="https://www.youtube.com/watch?v=${encodeURIComponent(clip.youtubeId)}&t=${clip.start}s" target="_blank" rel="noopener">Watch it on YouTube</a> instead; the code is still here.</p>`;
  }, 10_000);
  window.onYouTubeIframeAPIReady = () => {
    player = new window.YT.Player("player", {
      host: "https://www.youtube-nocookie.com",
      videoId: clip.youtubeId,
      playerVars: { start: clip.start, ...(clip.end !== null ? { end: clip.end } : {}), rel: 0, playsinline: 1 },
      events: {
        onReady: () => clearTimeout(fallback),
        onStateChange: e => {
          clearInterval(ticker);
          if (e.data === window.YT.PlayerState.PLAYING) ticker = setInterval(() => highlight(currentTime()), 250);
          highlight(currentTime());
        },
      },
    });
  };
  const s = document.createElement("script");
  s.src = "https://www.youtube.com/iframe_api";
  document.head.append(s);
}

// Runs last, once everything above is defined.
const id = new URLSearchParams(location.search).get("id");
const r = await api(`/api/learn/lessons/${encodeURIComponent(id ?? "")}`);

if (!r.ok) {
  $("lesson-title").textContent = r.status === 404 ? "Lesson not found" : "This lesson didn't load";
  $("crumbs").insertAdjacentHTML("afterend", `<p class="section-lede">${r.status === 404
    ? `It may have moved or not be published yet. <a href="/learn">See all CodeHub tracks</a>.`
    : esc(r.data.error)}</p>`);
} else {
  lesson = r.data;
  showLesson();
}
