import { renderService } from "./service.js";
import { $, api, esc, icon, money, date, toast, onUser, openSignIn, pill, STATUS, SUB_STATUS, PRODUCT_ICON } from "./common.js";

$("signin-here").addEventListener("click", () => openSignIn());
$("filter").addEventListener("change", loadOrders);

onUser(user => {
  const ok = !!user?.isAdmin;
  $("panel").hidden = !ok;
  $("denied").hidden = ok;
  if (user && !ok) {
    $("denied-text").textContent = `${user.email} isn't the site owner's account. Add it to ADMIN_EMAILS on the server to give it access.`;
    $("signin-here").hidden = true;
  }
  if (ok) { loadOverview(); loadOrders(); loadListings(); }
});

// ---------- Overview ----------
const dollars = cents => {
  const d = cents / 100;
  return d >= 1e6 ? `$${(d / 1e6).toFixed(1)}M` : d >= 1e4 ? `$${(d / 1e3).toFixed(1)}K` : `$${d.toLocaleString("en-US")}`;
};
const monthName = (ym, offset = 0) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + offset, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

async function loadOverview() {
  const r = await api("/api/admin/overview");
  if (!r.ok) { $("overview").innerHTML = `<p class="error">${esc(r.data.error)}</p>`; return; }
  const o = r.data;
  const diff = o.sales.cents - o.sales.lastMonthCents;
  const last = monthName(o.month, -1);
  const delta = diff === 0 ? `Same as ${last}`
    : `<span class="${diff > 0 ? "up" : "down"}">${diff > 0 ? "▲" : "▼"} ${dollars(Math.abs(diff))}</span> ${diff > 0 ? "more" : "less"} than ${last}`;

  const a = o.attention;
  const todo = [
    [a.notStarted, "paid", "info", plural(a.notStarted, "paid order isn't started", "paid orders aren't started")],
    [a.awaitingReply, "awaiting_reply", "wait", plural(a.awaitingReply, "customer is waiting for your reply", "customers are waiting for your reply")],
    [a.setupFailed, "setup_failed", "bad", plural(a.setupFailed, "server setup failed", "server setups failed")],
    [a.pastDue, "past_due", "bad", plural(a.pastDue, "subscription has an overdue payment", "subscriptions have overdue payments")],
    [a.pendingListings, "listings", "wait", plural(a.pendingListings, "showcase listing needs approval", "showcase listings need approval")],
  ].filter(([n]) => n > 0);

  $("overview").innerHTML = `
    <div class="overview-grid">
      <div class="panel hero-stat">
        <span class="stat-label">New sales in ${monthName(o.month)}</span>
        <span class="hero-figure">${dollars(o.sales.cents)}</span>
        <span class="stat-delta">${plural(o.sales.orders, "order", "orders")}. ${delta}</span>
      </div>
      <div class="stat-tiles">
        <div class="panel stat"><span class="stat-label">Recurring revenue</span><span class="stat-value">${dollars(o.recurringCents)}</span><span class="stat-delta">a month</span></div>
        <div class="panel stat"><span class="stat-label">Servers running</span><span class="stat-value">${o.activeServers.toLocaleString()}</span></div>
        <div class="panel stat"><span class="stat-label">Bots running</span><span class="stat-value">${o.activeBots.toLocaleString()}</span></div>
        <div class="panel stat"><span class="stat-label">Accounts</span><span class="stat-value">${o.customers.toLocaleString()}</span><span class="stat-delta">${o.newCustomers} new this month</span></div>
      </div>
    </div>
    <div class="panel attention">
      <h3>Needs you</h3>
      ${todo.length ? `<ul>${todo.map(([, key, tone, text]) => `<li>
          <span class="pill pill-${tone}">${tone === "bad" ? "Problem" : tone === "wait" ? "Waiting" : "To do"}</span>
          <span>${esc(text)}</span>
          <button class="btn btn-small" type="button" data-show="${key}">Show</button></li>`).join("")}</ul>`
        : `<p><span class="pill pill-done">All clear</span> Nothing needs you right now.</p>`}
      <p class="small">Renewal payments and payouts are in your <a href="https://dashboard.stripe.com" target="_blank" rel="noopener">Stripe dashboard</a>.</p>
    </div>`;
  $("overview").querySelectorAll("[data-show]").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.show === "listings") { $("listings-section").scrollIntoView({ behavior: "smooth" }); return; }
    $("filter").value = b.dataset.show;
    loadOrders();
    $("orders-section").scrollIntoView({ behavior: "smooth" });
  }));
}

const amountText = o => [o.amount ? money(o.amount) : "", o.monthly ? `${money(o.monthly)}/mo` : ""].filter(Boolean).join(" + ");
const statusOptions = current => Object.entries(STATUS)
  .map(([k, s]) => `<option value="${k}" ${k === current ? "selected" : ""}>${s.label}</option>`).join("");

async function loadOrders() {
  const status = $("filter").value;
  const r = await api(`/api/admin/orders${status ? `?status=${status}` : ""}`);
  const orders = r.data.orders ?? [];
  if (!orders.length) { $("orders").innerHTML = `<p class="hint">No orders here right now.</p>`; return; }
  $("orders").innerHTML = orders.map(o => `
    <details class="panel order" data-id="${o.id}">
      <summary>
        <span class="slot">${icon(PRODUCT_ICON[o.product] ?? "emerald")}</span>
        <span class="order-main"><strong>${esc(o.name)}</strong>
          <span class="small">Order ${o.id}, ${date(o.createdAt)}, ${amountText(o)}, ${o.customer ? esc(o.customer.email) : "deleted account"}${o.messageCount ? `, ${o.messageCount} message${o.messageCount > 1 ? "s" : ""}` : ""}</span></span>
        ${pill(o.status)}
      </summary>
      <div class="order-body"><p class="hint">Loading…</p></div>
    </details>`).join("");
  document.querySelectorAll("details.order").forEach(d =>
    d.addEventListener("toggle", () => { if (d.open && !d.dataset.loaded) loadOrder(d); }));
}

const thread = messages => messages.length
  ? messages.map(m => `<div class="msg-row ${m.fromOwner ? "from-me" : "from-owner"}">
      <b>${m.fromOwner ? "You" : "Customer"}</b><span class="small">${date(m.createdAt)}</span><p>${esc(m.body)}</p></div>`).join("")
  : `<p class="hint">No messages yet.</p>`;

async function loadOrder(d) {
  const r = await api(`/api/orders/${d.dataset.id}`);
  const body = d.querySelector(".order-body");
  if (!r.ok) { body.innerHTML = `<p class="error">${esc(r.data.error)}</p>`; return; }
  const o = r.data.order;
  d.dataset.loaded = "1";
  body.innerHTML = `
    ${o.monthly && o.subscriptionStatus ? `<p class="small">${esc(SUB_STATUS[o.subscriptionStatus] ?? o.subscriptionStatus)}</p>` : ""}
    <div class="service-box"></div>
    <h3>Brief from the customer</h3>
    <p class="brief">${o.brief ? esc(o.brief) : '<span class="hint">No brief yet.</span>'}</p>
    <form class="panel-inset update-form">
      <label>Status<select name="status">${statusOptions(o.status)}</select></label>
      <label>Delivery link<input name="deliverableUrl" type="url" value="${esc(o.deliverableUrl ?? "")}" placeholder="https://"></label>
      <button class="btn btn-buy" type="submit">Save changes</button>
    </form>
    <h3>Messages</h3>
    <div class="thread">${thread(o.messages)}</div>
    <form class="msg-form">
      <label class="sr-only" for="reply-${o.id}">Reply</label>
      <textarea id="reply-${o.id}" name="body" rows="2" maxlength="4000" placeholder="Reply to the customer"></textarea>
      <button class="btn btn-buy" type="submit">Send reply</button>
    </form>`;

  renderService(body.querySelector(".service-box"), o.service, { owner: true, reload: () => loadOrder(d) });

  body.querySelector(".update-form").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target;
    const res = await api(`/api/admin/orders/${o.id}`, { method: "PATCH", body: { status: f.status.value, deliverableUrl: f.deliverableUrl.value.trim() } });
    if (!res.ok) return toast(res.data.error);
    d.querySelector(".pill").outerHTML = pill(res.data.order.status);
    toast("Order saved.");
  });
  body.querySelector(".msg-form").addEventListener("submit", async e => {
    e.preventDefault();
    const text = e.target.body.value.trim();
    if (!text) return;
    const res = await api(`/api/orders/${o.id}/messages`, { method: "POST", body: { body: text } });
    if (!res.ok) return toast(res.data.error);
    e.target.body.value = "";
    body.querySelector(".thread").innerHTML = thread(res.data.messages);
    toast("Reply sent.");
  });
}

async function loadListings() {
  const r = await api("/api/admin/showcase");
  const listings = r.data.listings ?? [];
  const labels = { pending: "Waiting for approval", approved: "Live", hidden: "Hidden" };
  const tones = { pending: "wait", approved: "done", hidden: "muted" };
  $("listings").innerHTML = listings.length ? listings.map(l => `
    <div class="panel listing-row">
      <div><strong>${esc(l.title)}</strong> <span class="pill pill-${tones[l.status]}">${labels[l.status]}</span>
        <p class="small"><a href="${esc(l.url)}" target="_blank" rel="noopener nofollow">${esc(l.url)}</a>, by ${esc(l.owner)}</p>
        ${l.description ? `<p class="small">${esc(l.description)}</p>` : ""}</div>
      <div class="row-actions">
        ${l.status !== "approved" ? `<button class="btn btn-buy btn-small" type="button" data-set="approved" data-id="${l.id}">Approve</button>` : ""}
        ${l.status !== "hidden" ? `<button class="btn btn-small" type="button" data-set="hidden" data-id="${l.id}">Hide</button>` : ""}
      </div>
    </div>`).join("") : `<p class="hint">No listings yet.</p>`;
  $("listings").querySelectorAll("[data-set]").forEach(b => b.addEventListener("click", async () => {
    const res = await api(`/api/admin/showcase/${b.dataset.id}`, { method: "PATCH", body: { status: b.dataset.set } });
    if (res.ok) loadListings(); else toast(res.data.error);
  }));
}
