// CodeHub home (/learn): published tracks by level; opening a track lists its lessons.
import { $, api, esc } from "./common.js";

const LEVELS = [
  ["beginner", "Just started", "Never coded before? Start here."],
  ["hobby", "Hobby coder", "You know the basics and want to build bots, mods and apps."],
  ["pro", "Professional", "Deeper topics for people who code for work, or want to."],
  ["expert", "Expert", "The hardest projects: operating systems, compilers, game engines."],
];

const r = await api("/api/learn/tracks");
if (!r.ok) $("tracks").innerHTML = `<p class="error">${esc(r.data.error)}</p>`;
else if (!r.data.tracks.length) $("tracks").innerHTML = `<p class="hint">The first tracks are on their way. Check back soon.</p>`;
else {
  $("tracks").innerHTML = LEVELS.map(([level, name, lede]) => {
    const list = r.data.tracks.filter(t => t.level === level);
    return list.length ? `
      <section class="lh-level" aria-labelledby="level-${level}">
        <h2 id="level-${level}">${name}</h2>
        <p class="small">${lede}</p>
        <div class="lh-tracks">${list.map(t => `
          <details class="panel lh-track" data-slug="${esc(t.slug)}">
            <summary>
              <span class="lh-title">${esc(t.title)}</span>
              ${t.language ? `<span class="pill pill-muted">${esc(t.language)}</span>` : ""}
              <span class="small">${t.lessons} ${t.lessons === 1 ? "lesson" : "lessons"}</span>
              ${t.summary ? `<span class="lh-summary">${esc(t.summary)}</span>` : ""}
            </summary>
            <div class="lh-detail"><p class="hint">Loading lessons…</p></div>
          </details>`).join("")}</div>
      </section>` : "";
  }).join("");

  // Lessons load the first time a track is opened.
  document.querySelectorAll(".lh-track").forEach(d => d.addEventListener("toggle", async () => {
    if (!d.open || d.dataset.loaded) return;
    d.dataset.loaded = "1";
    const t = await api(`/api/learn/tracks/${encodeURIComponent(d.dataset.slug)}`);
    const box = d.querySelector(".lh-detail");
    if (!t.ok) { box.innerHTML = `<p class="error">${esc(t.data.error)}</p>`; delete d.dataset.loaded; return; }
    const { track, lessons } = t.data;
    const about = [["What to expect", track.expect], ["How to study it", track.study], ["What you'll make", track.make]].filter(([, v]) => v);
    box.innerHTML = `
      ${about.map(([h, v]) => `<h3>${h}</h3><p>${esc(v)}</p>`).join("")}
      ${lessons.length ? `<ol class="lh-lessons">${lessons.map(l => `
        <li><a href="/learn/lesson?id=${l.id}">${esc(l.title)}</a>${l.summary ? ` <span class="small">${esc(l.summary)}</span>` : ""}</li>`).join("")}</ol>`
        : `<p class="hint">Lessons are coming soon.</p>`}`;
  }));
}
