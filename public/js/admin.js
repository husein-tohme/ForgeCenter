import { $, api, esc, onUser, size, toast } from "./common.js";
onUser(async user => {
  const box = $("admin");
  if (!user?.isAdmin) { box.innerHTML = `<div class="empty">Owners only.</div>`; return; }
  const [s, r] = await Promise.all([api("/api/admin/stats"), api("/api/admin/reports")]);
  const st = s.data;
  box.innerHTML = `<div class="grid">${[["Users", st.users], ["Repos", st.repos], ["Files", `${st.files} (${size(st.bytes)})`], ["Sales", st.sales], ["Open reports", st.openReports]]
      .map(([k, v]) => `<div class="card"><p>${k}</p><h3 style="color:var(--text);font-size:1.6rem">${v}</h3></div>`).join("")}</div>
    <h2 style="margin-top:28px">Open reports</h2>
    ${(r.data.reports ?? []).map(x => `<div class="panel" style="margin-bottom:10px"><b>${esc(x.target_type)}: ${esc(x.target_id)}</b> · ${esc(x.reason)} · from @${esc(x.reporter ?? "deleted")}
      <p class="muted">${esc(x.details)}</p><div class="row">
      ${x.target_type === "repo" ? `<a class="btn btn-small" href="/${esc(x.target_id)}">Open</a>` : x.target_type === "product" ? `<a class="btn btn-small" href="/store/${esc(x.target_id)}">Open</a>` : `<a class="btn btn-small" href="/${esc(x.target_id)}">Open</a>`}
      <button class="btn btn-small btn-danger" data-suspend="${esc(x.target_type === "user" ? x.target_id : x.target_id.split("/")[0])}" ${x.target_type === "product" ? "hidden" : ""}>Suspend owner</button>
      <button class="btn btn-small" data-close="${x.id}">Close</button></div></div>`).join("") || `<p class="muted">No open reports.</p>`}`;
  box.querySelectorAll("[data-close]").forEach(b => b.onclick = async () => { await api(`/api/admin/reports/${b.dataset.close}/close`, { method: "POST" }); location.reload(); });
  box.querySelectorAll("[data-suspend]").forEach(b => b.onclick = async () => {
    if (!confirm(`Suspend @${b.dataset.suspend}?`)) return;
    const x = await api(`/api/admin/users/${encodeURIComponent(b.dataset.suspend)}/suspend`, { method: "POST", body: {} });
    toast(x.ok ? "Suspended." : x.data.error);
  });
});
