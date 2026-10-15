// The "your server" / "your bot" part of an order, shared by the account page and the owner panel.
import { api, esc, date, toast } from "./common.js";

const uptime = s => (s >= 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
  : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m`);
const SERVER_STATE = { running: ["Online", "done"], starting: ["Starting", "wait"], stopping: ["Stopping", "wait"], offline: ["Offline", "muted"] };
const BOT_STATE = { running: ["Online", "done"], starting: ["Starting", "wait"], crashed: ["Crashed", "bad"], stopped: ["Stopped", "muted"] };
const pillFor = ([label, tone]) => `<span class="pill pill-${tone}">${label}</span>`;

export function renderService(el, service, { owner = false, reload } = {}) {
  if (!service) { el.innerHTML = ""; return; }
  el.innerHTML = `<h3>${service.kind === "minecraft" ? "Your server" : "Your bot"}</h3>${service.kind === "minecraft" ? minecraft(service) : bot(service)}
    ${owner ? ownerInfo(service) : ""}`;
  (service.kind === "minecraft" ? wireMinecraft : wireBot)(el, service, reload);
  el.querySelector("[data-retry]")?.addEventListener("click", async () => {
    const r = await api(`/api/admin/services/${service.id}/retry`, { method: "POST" });
    toast(r.ok ? "Trying again now." : r.data.error);
    reload?.();
  });
}

function ownerInfo(s) {
  return `<div class="owner-info">
    <p class="small">Setup state: <strong>${esc(s.state)}</strong>${s.attempts ? `, ${s.attempts} failed tries` : ""}</p>
    ${s.lastError ? `<p class="error">${esc(s.lastError)}</p>` : ""}
    ${s.log ? `<pre class="log">${esc(s.log)}</pre>` : ""}
    <button class="btn btn-small" type="button" data-retry>Retry now</button></div>`;
}

// ---------- Minecraft ----------
function minecraft(s) {
  if (s.state === "provisioning") return `<p>Your server is being set up. This usually takes a few minutes, and you'll get an email when it's ready.</p>`;
  if (s.state === "failed") return `<p>Setting up your server hit a problem. ForgeCenter has been told and will fix it, so there's nothing you need to do.</p>`;
  if (s.state === "deleted") return `<p>This server has been removed.</p>`;
  if (s.state === "suspended") {
    return s.deleteAfter
      ? `<p>Your subscription ended, so the server is paused. It will be deleted on ${date(new Date(s.deleteAfter).toISOString())}. Send a message below if you'd like a copy of your world first.</p>`
      : `<p>Your server is paused because the last payment didn't go through. Update your card in Manage billing and it comes back on its own.</p>`;
  }
  return `
    <div class="server-address">
      <span class="small">Server address</span>
      <code class="address">${esc(s.address ?? "Being assigned…")}</code>
      ${s.address ? `<button class="btn btn-small" type="button" data-copy="${esc(s.address)}">Copy</button>` : ""}
    </div>
    <p class="small">In Minecraft, go to Multiplayer, then Add Server, and paste this address.</p>
    <div class="server-status" data-status><p class="hint">Checking the server…</p></div>
    <div class="power-row">
      <button class="btn btn-buy btn-small" type="button" data-power="start">Start</button>
      <button class="btn btn-small" type="button" data-power="restart">Restart</button>
      <button class="btn btn-small" type="button" data-power="stop">Stop</button>
      <button class="link-btn" type="button" data-refresh>Refresh</button>
    </div>
    <form class="command-form" data-command>
      <label>Run a server command<input name="command" maxlength="200" placeholder="whitelist add Steve" autocomplete="off"></label>
      <button class="btn btn-small" type="submit">Run</button>
    </form>
    ${s.panelUrl ? `<p class="small">For files, plugins and backups, use the <a href="${esc(s.panelUrl)}" target="_blank" rel="noopener">full control panel</a>. The first time, choose "Forgot password" there and use your account email.</p>` : ""}`;
}

function wireMinecraft(el, s) {
  if (s.state !== "active") return;
  const statusBox = el.querySelector("[data-status]");
  const refresh = async () => {
    const r = await api(`/api/services/${s.id}/status`);
    const res = r.data.resources;
    if (!res) { statusBox.innerHTML = `<p class="hint">${esc(r.data.resourcesError || r.data.error || "Live status isn't available.")}</p>`; return; }
    statusBox.innerHTML = `<div class="stats">
      ${pillFor(SERVER_STATE[res.state] ?? [res.state, "muted"])}
      <span><strong>${res.memoryMb.toLocaleString()} MB</strong> memory used</span>
      <span><strong>${res.cpuPercent}%</strong> CPU</span>
      <span><strong>${(res.diskMb / 1024).toFixed(1)} GB</strong> storage used</span>
      ${res.state === "running" ? `<span>Up for <strong>${uptime(res.uptimeSeconds)}</strong></span>` : ""}
    </div>`;
  };
  refresh();
  el.querySelector("[data-refresh]").addEventListener("click", refresh);
  el.querySelector("[data-copy]")?.addEventListener("click", e => {
    navigator.clipboard?.writeText(e.target.dataset.copy).then(() => toast("Address copied."), () => toast("Copy didn't work. Select the address and copy it."));
  });
  el.querySelectorAll("[data-power]").forEach(b => b.addEventListener("click", async () => {
    b.disabled = true;
    const r = await api(`/api/services/${s.id}/power`, { method: "POST", body: { signal: b.dataset.power } });
    b.disabled = false;
    toast(r.ok ? { start: "Starting the server.", restart: "Restarting the server.", stop: "Stopping the server." }[b.dataset.power] : r.data.error);
    setTimeout(refresh, 3000);
  }));
  el.querySelector("[data-command]").addEventListener("submit", async e => {
    e.preventDefault();
    const command = e.target.command.value.trim();
    if (!command) return;
    const r = await api(`/api/services/${s.id}/command`, { method: "POST", body: { command } });
    if (!r.ok) return toast(r.data.error);
    e.target.command.value = "";
    toast(`Ran: ${command}`);
  });
}

// ---------- Discord bot ----------
const tokenForm = (label) => `
  <form class="token-form" data-token>
    <label>Bot token<input name="token" type="password" autocomplete="off" required placeholder="Paste the token from the Bot page"></label>
    <button class="btn btn-buy" type="submit">${label}</button>
  </form>`;

function bot(s) {
  if (s.state === "waiting_setup") {
    return `<p>Your bot is ready to switch on. It runs as your own Discord application, so it has your name and picture.</p>
      <ol class="setup-steps">
        <li>Open the <a href="https://discord.com/developers/applications" target="_blank" rel="noopener">Discord Developer Portal</a> and choose <strong>New Application</strong>. Give it your bot's name.</li>
        <li>On the <strong>Bot</strong> page, turn on <strong>Server Members Intent</strong> and <strong>Message Content Intent</strong>, then save.</li>
        <li>On the same page, choose <strong>Reset Token</strong> and copy the token. Treat it like a password.</li>
        <li>Paste it here. ForgeCenter checks it with Discord and stores it encrypted.</li>
      </ol>${tokenForm("Switch on my bot")}`;
  }
  if (s.state !== "active") return `<p>This bot is no longer running.</p>`;
  const b = s.bot;
  return `
    <div class="stats">${pillFor(BOT_STATE[b.status] ?? ["Starting", "wait"])}
      <span><strong>${esc(b.name ?? "Your bot")}</strong></span>
      ${b.status === "running" && b.startedAt ? `<span>Online since ${date(new Date(b.startedAt).toISOString())}</span>` : ""}</div>
    ${b.inviteUrl ? `<p><a class="btn btn-buy" href="${esc(b.inviteUrl)}" target="_blank" rel="noopener">Add the bot to your server</a></p>
      <p class="small">Then, in your server, drag the bot's role above the roles it should hand out, and run <code>/setup</code>.</p>` : ""}
    ${b.status === "crashed" ? `<p class="error">The bot stopped. It restarts on its own, but if this keeps happening, check that both intents are on and the token is current.</p>
      ${b.log ? `<pre class="log">${esc(b.log)}</pre>` : ""}` : ""}
    <div class="power-row">
      <button class="btn btn-small" type="button" data-bot-restart>Restart bot</button>
      <button class="link-btn" type="button" data-refresh>Refresh</button>
    </div>
    <details class="replace-token"><summary>Replace the token</summary>${tokenForm("Save new token")}</details>`;
}

function wireBot(el, s, reload) {
  el.querySelector("[data-token]")?.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button"); btn.disabled = true;
    const r = await api(`/api/services/${s.id}/bot`, { method: "POST", body: { token: e.target.token.value.trim() } });
    btn.disabled = false;
    if (!r.ok) return toast(r.data.error);
    toast(r.data.warning || "Your bot is starting. Add it to your server next.");
    renderService(el, r.data.service, { reload });
  });
  el.querySelector("[data-bot-restart]")?.addEventListener("click", async () => {
    const r = await api(`/api/services/${s.id}/restart`, { method: "POST" });
    toast(r.ok ? "Restarting your bot. This takes a few seconds." : r.data.error);
  });
  el.querySelector("[data-refresh]")?.addEventListener("click", () => reload?.());
}
