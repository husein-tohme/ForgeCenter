import { $, api, esc, date, toast, onUser, openSignIn, getUser } from "./common.js";
import { ARTICLES } from "./help-articles.js";

// ---------- Help articles ----------
// Trusted text with two marks: **bold** for labels and [words](link).
const inline = text => esc(text)
  .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, words, href) => href.startsWith("/")
    ? `<a href="${href}">${words}</a>`
    : `<a href="${href}" target="_blank" rel="noopener">${words}</a>`);
const block = b => b.h ? `<h3>${esc(b.h)}</h3>`
  : b.steps ? `<ol>${b.steps.map(s => `<li>${inline(s)}</li>`).join("")}</ol>`
  : b.list ? `<ul>${b.list.map(s => `<li>${inline(s)}</li>`).join("")}</ul>`
  : b.note ? `<p class="note">${inline(b.note)}</p>`
  : `<p>${inline(b.p)}</p>`;

// Everything a search can match, without the marks.
const plain = s => s.replace(/\*\*|\[|\]\([^)]*\)/g, "");
const haystack = new Map(ARTICLES.map(a => [a.id, [a.title, a.tags, a.summary,
  ...a.body.flatMap(b => b.steps ?? b.list ?? [b.h ?? b.p ?? b.note])].map(plain).join(" ").toLowerCase()]));

// The search box shows articles containing every word typed. Suggestions for a ticket
// take any article matching a meaningful word, since subjects are full sentences.
const SKIP = new Set("the and but can cant how what why when where who not won don doesn didn isn wont dont does did has have its my me you your for from with this that just get got any all are was".split(" "));
function search(query, { any = false } = {}) {
  let words = query.toLowerCase().match(/[\p{L}\p{N}$]+/gu) ?? [];
  if (any) words = words.filter(w => w.length >= 3 && !SKIP.has(w));
  if (!words.length) return any ? [] : ARTICLES;
  return ARTICLES
    .map(a => ({ a, hits: words.filter(w => haystack.get(a.id).includes(w)).length,
      title: words.filter(w => a.title.toLowerCase().includes(w)).length }))
    .filter(x => any ? x.hits > 0 : x.hits === words.length)
    .sort((x, y) => (y.hits + y.title) - (x.hits + x.title)).map(x => x.a);
}

$("articles").innerHTML = ARTICLES.map(a => `
  <details id="${a.id}">
    <summary>${esc(a.title)}</summary>
    <div class="article-body"><p class="small">${esc(a.summary)}</p>${a.body.map(block).join("")}
      <p class="small">Still stuck? <a href="#new-ticket" data-ask="${a.id}">Open a support ticket</a>.</p></div>
  </details>`).join("");

$("article-search").addEventListener("input", e => {
  const found = new Set(search(e.target.value).map(a => a.id));
  for (const d of $("articles").children) d.hidden = !found.has(d.id);
  $("article-count").textContent = e.target.value.trim()
    ? (found.size ? `${found.size} ${found.size === 1 ? "article matches" : "articles match"}.` : "No articles match. Try other words, or open a ticket below.")
    : "";
});

// /support#wallet opens that article, including from a link in a ticket.
function openFromHash() {
  const d = ARTICLES.some(a => a.id === location.hash.slice(1)) && document.getElementById(location.hash.slice(1));
  if (!d) return;
  d.hidden = false; d.open = true;
  d.scrollIntoView({ block: "start" });
  d.querySelector("summary").focus({ preventScroll: true });
}
addEventListener("hashchange", openFromHash);
openFromHash();
// Clicking a link to the article already in the address bar still opens it.
document.addEventListener("click", e => {
  const a = e.target.closest('a[href^="/support#"]');
  if (a && a.hash === location.hash) { e.preventDefault(); openFromHash(); }
});

$("articles").addEventListener("click", async e => {
  const ask = e.target.closest("[data-ask]");
  if (!ask) return;
  e.preventDefault();
  if (!getUser()) return openSignIn();
  if (current || !$("ticket-form")) await showNewForm();
  $("support").scrollIntoView({ block: "start" });
  $("ticket-form")?.elements.category.focus({ preventScroll: true });
});

// Article links in replies, like /support#wallet, open the article on this page.
const linkArticles = html => html.replace(/(?:https?:\/\/[^\s/]+)?\/support#([a-z-]+)/g,
  (link, id) => ARTICLES.some(a => a.id === id) ? `<a href="/support#${id}">${link}</a>` : link);

const STATE = {
  ai: ["Forge Support is helping", "info"],
  waiting: ["Waiting for the team", "wait"],
  answered: ["The team replied", "done"],
  closed: ["Closed", "muted"],
};
const AUTHOR = { customer: "You", ai: "Forge Support (AI)", staff: "ForgeCenter team" };
const statePill = s => { const [label, tone] = STATE[s] ?? [s, "muted"]; return `<span class="pill pill-${tone}">${esc(label)}</span>`; };
const when = iso => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

let categories = {}, aiOn = true, current = null, shown = null;
const wanted = Number(new URLSearchParams(location.search).get("ticket")) || null;

$("signin-here").addEventListener("click", () => openSignIn());
$("new-ticket").addEventListener("click", () => showNewForm());

onUser(async user => {
  $("signed-out").hidden = !!user;
  $("support").hidden = !user;
  if (!user?.ageGroup || user.ageGroup === "under13") return;
  await loadList();
  if (current) return;
  if (wanted) openTicket(wanted); else showNewForm();
});

function markCurrent() {
  $("tickets").querySelectorAll("[data-ticket]").forEach(b => b.setAttribute("aria-current", String(Number(b.dataset.ticket) === current)));
}

async function loadList() {
  const r = await api("/api/support");
  if (!r.ok) return;
  ({ categories, ai: aiOn } = r.data);
  $("tickets").innerHTML = r.data.tickets.length ? r.data.tickets.map(t => `<li>
      <button class="ticket-link" type="button" data-ticket="${t.id}">
        <strong>${esc(t.subject)}</strong><span class="small">${esc(t.categoryName)}, ${date(t.updatedAt)}</span>${statePill(t.status)}
      </button></li>`).join("")
    : `<li class="hint">No tickets yet.</li>`;
  $("tickets").querySelectorAll("[data-ticket]").forEach(b => b.addEventListener("click", () => openTicket(Number(b.dataset.ticket))));
  markCurrent();
}

async function showNewForm() {
  current = null; shown = null;
  markCurrent();
  const orders = (await api("/api/orders")).data.orders ?? [];
  $("ticket-view").innerHTML = `
    <h2>New ticket</h2>
    <form class="ticket-form" id="ticket-form">
      <label>What's it about?<select name="category" required><option value=""></option>
        ${Object.entries(categories).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></label>
      ${orders.length ? `<label>Which order? (optional)<select name="orderId"><option value="">None</option>
        ${orders.map(o => `<option value="${o.id}">Order ${o.id}: ${esc(o.name)}</option>`).join("")}</select></label>` : ""}
      <label>Subject<input name="subject" required maxlength="120" placeholder="My server won't start"></label>
      <p class="small suggested" id="suggested" aria-live="polite"></p>
      <label>Message<textarea name="body" required rows="6" maxlength="4000" placeholder="What happened, and what have you tried?"></textarea></label>
      <p class="small">${aiOn ? "Forge Support usually answers within a minute." : `A person will reply here${getUser()?.email ? ", and you'll get an email" : ""}.`} Never share passwords, sign-in codes or bot tokens.</p>
      <button class="btn btn-buy" type="submit">Send</button>
    </form>`;
  // Point to articles that might already answer it.
  $("ticket-form").elements.subject.addEventListener("input", e => {
    const hits = search(e.target.value, { any: true }).slice(0, 3);
    $("suggested").innerHTML = hits.length
      ? `These might help: ${hits.map(a => `<a href="/support#${a.id}">${esc(a.title)}</a>`).join(", ")}` : "";
  });
  $("ticket-form").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target.elements;
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true;
    if (aiOn) btn.textContent = "Forge Support is reading it…";
    const r = await api("/api/support", { method: "POST", body: {
      category: f.category.value, orderId: f.orderId?.value || null, subject: f.subject.value, body: f.body.value } });
    btn.disabled = false; btn.textContent = "Send";
    if (!r.ok) return toast(r.data.error);
    render(r.data.ticket);
    loadList();
  });
}

async function openTicket(id) {
  const r = await api(`/api/support/${id}`);
  if (!r.ok) { toast(r.data.error); return showNewForm(); }
  render(r.data.ticket);
}

const bubble = (author, body, at, extra = "") =>
  `<div class="msg-row from-${author}${extra}"><b>${AUTHOR[author]}</b>${at ? `<span class="small">${when(at)}</span>` : ""}<p>${author === "customer" ? esc(body) : linkArticles(esc(body))}</p></div>`;

function render(t, pending = null) {
  current = t.id; shown = t;
  markCurrent();
  const open = t.status !== "closed";
  $("ticket-view").innerHTML = `
    <div class="ticket-head">
      <div><h2>${esc(t.subject)}</h2><p class="small">Ticket ${t.id}, ${esc(t.categoryName)}${t.orderId ? `, order ${t.orderId}` : ""}</p></div>
      ${statePill(t.status)}
    </div>
    <div class="thread">
      ${t.messages.map(m => bubble(m.author, m.body, m.createdAt)).join("")}
      ${pending ? bubble("customer", pending) + (t.status === "ai" ? bubble("ai", "Writing an answer…", null, " typing") : "") : ""}
    </div>
    ${open ? `
      <form class="msg-form" id="reply-form">
        <label class="sr-only" for="reply">Reply</label>
        <textarea id="reply" name="body" rows="3" maxlength="4000" placeholder="Write a reply" required ${pending ? "disabled" : ""}></textarea>
        <button class="btn btn-buy" type="submit" ${pending ? "disabled" : ""}>Send reply</button>
      </form>
      <div class="ticket-actions">
        ${t.status === "ai" ? `<button class="btn" type="button" id="handoff">Talk to a person</button>` : ""}
        <button class="link-btn" type="button" id="close-ticket">Close ticket</button>
      </div>` : `<p class="hint">This ticket is closed. Open a new one if you need more help.</p>`}`;
  if (!open || pending) return;

  $("reply-form").addEventListener("submit", async e => {
    e.preventDefault();
    const text = e.target.elements.body.value.trim();
    if (!text) return;
    render(t, text);
    const r = await api(`/api/support/${t.id}/messages`, { method: "POST", body: { body: text } });
    if (!r.ok) { render(t); $("reply").value = text; return toast(r.data.error); }
    render(r.data.ticket);
    loadList();
  });
  $("handoff")?.addEventListener("click", async () => {
    const r = await api(`/api/support/${t.id}/handoff`, { method: "POST" });
    if (!r.ok) return toast(r.data.error);
    render(r.data.ticket);
    loadList();
  });
  $("close-ticket").addEventListener("click", async () => {
    const r = await api(`/api/support/${t.id}/close`, { method: "POST" });
    if (!r.ok) return toast(r.data.error);
    render(r.data.ticket);
    loadList();
    toast("Ticket closed.");
  });
}

// Pick up the team's replies while the page is open, without wiping a half-written reply.
setInterval(async () => {
  if (!shown || shown.status === "closed" || document.visibilityState !== "visible" || $("reply")?.value || $("reply")?.disabled) return;
  const r = await api(`/api/support/${shown.id}`);
  if (r.ok && r.data.ticket.messages.length !== shown.messages.length && r.data.ticket.id === current) { render(r.data.ticket); loadList(); }
}, 30_000);
