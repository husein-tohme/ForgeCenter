import { $, api, esc, ago, onUser, openSignIn, openReport, toast } from "./common.js";
const box = $("inbox");
const current = () => new URLSearchParams(location.search).get("to");
const pic = u => u.picture ? `<img class="avatar" src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar" aria-hidden="true"></span>`;

async function render() {
  const [list, thread] = await Promise.all([api("/api/messages"), current() ? api(`/api/messages/${encodeURIComponent(current())}`) : null]);
  const threads = list.data.threads ?? [];
  const t = thread?.ok ? thread.data : null;
  box.innerHTML = `<nav class="threads" aria-label="Conversations">${threads.map(x => `<a class="thread" href="?to=${esc(x.username)}" aria-current="${x.username === current()}">
      ${pic(x)}<span><b>${esc(x.name)}</b><span class="last">${x.lastFromMe ? "You: " : ""}${esc(x.last)}</span></span>${x.unread ? `<span class="badge">${x.unread}</span>` : ""}</a>`).join("")
      || `<p class="empty">No messages yet. Open someone's profile and press Message.</p>`}</nav>
    <section class="convo" aria-label="Conversation">${t ? `
      <div class="convo-head">${pic(t.with)}<b><a href="/${esc(t.with.username)}">${esc(t.with.name)}</a></b><span class="muted">@${esc(t.with.username)}</span><span style="flex:1"></span>
        <button class="btn btn-small" id="block">${t.blockedByMe ? "Unblock" : "Block"}</button><button class="btn btn-small" id="report">Report</button></div>
      <div class="convo-log" id="log" aria-live="polite">${t.messages.map(m => `<div class="msg ${m.mine ? "me" : "ai"}" title="${esc(new Date(m.at).toLocaleString())}">${esc(m.body)}</div>`).join("")
        || `<p class="muted">Say hi! Keep payments on Forgehub and never share passwords.</p>`}</div>
      ${t.canSend ? `<form class="convo-form" id="send"><label class="sr-only" for="body">Message</label><input id="body" maxlength="2000" placeholder="Write a message…" required autocomplete="off"><button class="btn btn-primary">Send</button></form>`
        : `<p class="convo-form muted">You can't message this person.</p>`}`
      : `<div class="empty" style="grid-row:1/-1">${current() ? esc(thread?.data.error ?? "") : "Pick a conversation."}</div>`}</section>`;
  if (!t) return;
  $("log").scrollTop = 1e9;
  $("send")?.addEventListener("submit", async e => {
    e.preventDefault();
    const r = await api(`/api/messages/${encodeURIComponent(current())}`, { method: "POST", body: { body: $("body").value } });
    if (!r.ok) return toast(r.data.error);
    render();
  });
  $("block").onclick = async () => {
    await api(`/api/messages/${encodeURIComponent(current())}/block`, { method: "POST", body: { block: !t.blockedByMe } });
    toast(t.blockedByMe ? "Unblocked." : "Blocked. They can't message you.");
    render();
  };
  $("report").onclick = () => openReport("user", t.with.username);
}

onUser(user => {
  if (!user) { box.innerHTML = `<div class="empty"><p>Sign in to see your messages.</p><button class="btn btn-primary" id="si">Sign in</button></div>`; $("si").onclick = () => openSignIn(); return; }
  render();
  // New messages show up without reloading.
  setInterval(() => { if (!document.hidden && document.activeElement?.id !== "body") render(); }, 15000);
});
