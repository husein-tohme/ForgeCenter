import { $, api, esc, date, toast, onUser, openSignIn, getUser } from "./common.js";

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
      <label>Message<textarea name="body" required rows="6" maxlength="4000" placeholder="What happened, and what have you tried?"></textarea></label>
      <p class="small">${aiOn ? "Forge Support usually answers within a minute." : `A person will reply here${getUser()?.email ? ", and you'll get an email" : ""}.`} Never share passwords, sign-in codes or bot tokens.</p>
      <button class="btn btn-buy" type="submit">Send</button>
    </form>`;
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
  `<div class="msg-row from-${author}${extra}"><b>${AUTHOR[author]}</b>${at ? `<span class="small">${when(at)}</span>` : ""}<p>${esc(body)}</p></div>`;

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
