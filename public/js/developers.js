import { $, api, esc, icon, registerIcons, toast, onUser, ready, openSignIn, cash, date, stack } from "./common.js";

registerIcons({
  // A command block with a green prompt.
  command: { c: { O: "#8a4f22", o: "#d98c4a", k: "#2b2b2b", w: "#6fe0a0" }, m: [
    "OOOOOOOO", "OooooooO", "OokkkkoO", "OokwkkoO", "OokkwkoO", "OokwkkoO", "OooooooO", "OOOOOOOO"] },
  key: { c: { g: "#f2c230", G: "#b8860b" }, m: [
    "........", ".ggg....", "gG.Gg...", "g...gggg", "gG.Gg.gG", ".ggg..G.", "........", "........"] },
});
$("dev-icon").innerHTML = icon("command");

const ENDPOINT_TEXT = { chat: "AI chat", mods: "Mod zip", plugins: "Plugin zip", texturepacks: "Texture pack zip", "modrinth/search": "Modrinth search" };
const when = iso => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const count = n => Number(n).toLocaleString("en-US");
const cents = n => (n === 1 ? "1 cent" : `${n} cents`);

// ---------- Prices ----------
let pricing = null;
const chatCost = (input, output) => Math.max(pricing.chat.minimum,
  Math.ceil((input * pricing.chat.inputPerMillion + output * pricing.chat.outputPerMillion) / 1_000_000));

api("/api/developer/pricing").then(r => {
  if (!r.ok) { $("price-list").innerHTML = `<p class="hint">Prices couldn't load. Refresh the page to try again.</p>`; return; }
  pricing = r.data.pricing;
  const { chat, generator, search } = pricing;
  const rows = [
    { icon: "eye", name: "AI chat", desc: `Claude Opus 5.5. You pay for the text that goes in and comes out, counted in tokens (about 4 characters each). A short question and answer costs about ${cents(chatCost(50, 300))}.${r.data.ai ? "" : " Not switched on for this site yet."}`,
      price: `<span><strong>${cash(chat.inputPerMillion)}</strong> per million tokens in</span><span><strong>${cash(chat.outputPerMillion)}</strong> per million tokens out</span>` },
    { icon: "anvil", name: "Mods, plugins and texture packs", desc: "A ready-made project zip from Mod Forge, Plugin Forge or Texture Forge.",
      price: `<span><strong>${cash(generator)}</strong> a zip</span>` },
    { icon: "chest", name: "Modrinth search", desc: "Up to 20 Fabric mods or server plugins that match.", price: `<span><strong>${cash(search)}</strong> a search</span>` },
    { icon: "key", name: "Checking your key", desc: "Your key's name and your wallet balance.", price: `<span><strong>Free</strong></span>` },
  ];
  $("price-list").innerHTML = rows.map(p => `<div class="trade">
      <div class="slot">${icon(p.icon)}</div>
      <div><h3>${esc(p.name)}</h3><p>${esc(p.desc)}</p></div>
      <div class="dev-price">${p.price}</div>
    </div>`).join("");
  document.querySelectorAll("[data-price]").forEach(el => {
    el.textContent = el.dataset.price === "chat"
      ? `${cash(chat.inputPerMillion)} per million tokens in and ${cash(chat.outputPerMillion)} per million tokens out, at least ${cents(chat.minimum)} a call`
      : cents(pricing[el.dataset.price]);
  });
});

// ---------- Copy buttons on the examples ----------
async function copy(text, el) {
  try { await navigator.clipboard.writeText(text); toast("Copied."); }
  catch {
    const range = document.createRange(); range.selectNodeContents(el);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    toast("Press Ctrl+C (or Cmd+C) to copy.");
  }
}
document.querySelectorAll(".code-block").forEach(block => {
  const pre = block.querySelector("pre");
  block.insertAdjacentHTML("afterbegin", `<div class="code-bar"><button class="btn btn-small copy-btn" type="button">Copy</button></div>`);
  block.querySelector(".copy-btn").addEventListener("click", () => copy(pre.textContent, pre));
});

// ---------- Who's here ----------
let loadedFor = null;
// After the account has loaded, so people who are signed in don't see the sign-in prompt flash.
ready.then(() => onUser(user => {
  const adult = user?.ageGroup === "adult";
  $("usage-panel").hidden = !adult;
  $("calls-section").hidden = !adult;
  $("dev-grid").classList.toggle("single", !adult);
  if (!adult) { loadedFor = null; $("key-reveal").hidden = true; }
  if (!user) return signedOut();
  if (!user.ageGroup || user.ageGroup === "under13") { $("keys-body").innerHTML = `<p class="hint">Answer the birthday question to continue.</p>`; return; }
  if (!adult) return teen();
  if (loadedFor === user.id) return;
  loadedFor = user.id;
  loadKeys(); loadUsage();
}));

function signedOut() {
  $("keys-body").innerHTML = `
    <p>Sign in to make API keys and see what you've spent. Keys are for confirmed adults (18+).</p>
    <button class="btn btn-buy" type="button" id="keys-signin">Sign in</button>`;
  $("keys-signin").addEventListener("click", () => openSignIn());
}

function teen() {
  $("keys-body").innerHTML = `
    <div class="age-status dev-gate">
      <span class="slot">${icon("idcard")}</span>
      <div class="grow">
        <p><span class="pill pill-muted">Teen</span> API keys are for confirmed adults (18+), because a key gives direct access to Claude and spends money from your wallet without asking each time.</p>
        <p class="small">Your account is in the teen group. If you're 18 or over, confirm your age. ForgeCenter keeps only the result. The <a href="/#tools">free tools</a> and the <a href="/#mentor">Forge mentor</a> work for everyone.</p>
      </div>
      <button class="btn btn-buy" type="button" data-confirm-age>Confirm your age</button>
    </div>`;
}

// ---------- Keys ----------
async function loadKeys() {
  const r = await api("/api/developer/keys");
  if (!r.ok) { $("keys-body").innerHTML = `<p class="error">${esc(r.data.error)}</p>`; return; }
  const { keys, max } = r.data;
  const full = keys.length >= max;
  $("keys-body").innerHTML = `
    ${full ? `<p>You have ${max} keys, the most an account can have. Revoke one you don't use to make another.</p>` : `
      <form class="inline-form key-form" id="key-form">
        <label class="grow">Name your new key<input name="name" maxlength="40" required autocomplete="off" placeholder="My Discord bot"></label>
        <button class="btn btn-buy" type="submit">Create key</button>
      </form>
      <p class="small">Make one key for each app, so you can revoke one without breaking the others. ${keys.length} of ${max} used.</p>`}
    <ul class="key-list">${keys.length ? keys.map(k => `
      <li class="key-row">
        <span class="slot">${icon("key")}</span>
        <div>
          <strong>${esc(k.name)}</strong>
          <code>${esc(k.prefix)}…</code>
          <span class="small">Made ${date(k.createdAt)}. ${k.lastUsedAt ? `Last used ${when(k.lastUsedAt)}.` : "Not used yet."}</span>
        </div>
        <button class="btn btn-small btn-danger" type="button" data-revoke="${k.id}" data-name="${esc(k.name)}">Revoke</button>
      </li>`).join("") : `<li class="hint">No keys yet.</li>`}
    </ul>`;

  $("key-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true;
    const res = await api("/api/developer/keys", { method: "POST", body: { name: e.target.elements.name.value } });
    btn.disabled = false;
    if (!res.ok) {
      if (res.data.needs === "adult") return teen();
      return toast(res.data.error || "The key couldn't be made. Try again in a moment.");
    }
    reveal(res.data);
    loadKeys();
  });
  $("keys-body").querySelectorAll("[data-revoke]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm(`Revoke "${b.dataset.name}"? Anything using it stops working straight away. This can't be undone.`)) return;
    b.disabled = true;
    const res = await api(`/api/developer/keys/${b.dataset.revoke}`, { method: "DELETE" });
    if (!res.ok) { b.disabled = false; return toast(res.data.error); }
    toast("Key revoked.");
    loadKeys();
  }));
}

// The key is shown once, straight after it's made. Only a scrambled copy is kept.
function reveal(k) {
  const box = $("key-reveal");
  box.innerHTML = `
    <h3>Copy your new key now</h3>
    <p>This is the only time you'll see the key for <strong>${esc(k.name)}</strong>. ForgeCenter keeps only a scrambled copy, so it can't show it again.</p>
    <div class="key-secret-row"><code class="key-secret" id="new-key">${esc(k.key)}</code>
      <button class="btn btn-small" type="button" id="copy-key">Copy</button></div>
    <p class="small">Anyone with this key can spend your wallet. Keep it in your server or bot settings, never in a web page, an app you share, a screenshot or a public repo.</p>
    <button class="btn btn-small" type="button" id="key-saved">I've saved it</button>`;
  box.hidden = false;
  $("copy-key").addEventListener("click", () => copy(k.key, $("new-key")));
  $("key-saved").addEventListener("click", () => { box.hidden = true; box.innerHTML = ""; });
  box.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// ---------- Wallet and spending ----------
async function loadUsage() {
  const r = await api("/api/developer/usage");
  if (!r.ok) { $("usage-body").innerHTML = `<p class="error">${esc(r.data.error)}</p>`; return; }
  const { month, totals, byEndpoint, recent, balance } = r.data;
  const monthName = new Date(`${month}-01T00:00:00Z`).toLocaleString(undefined, { month: "long", timeZone: "UTC" });
  $("usage-body").innerHTML = `
    <div class="dev-wallet">
      ${stack(balance, { big: true })}
      <div><span class="stat-label">Wallet balance</span><a class="btn btn-buy" href="/account#wallet">Add funds</a></div>
    </div>
    <div class="usage-stats">
      <div><span class="stat-label">Spent in ${esc(monthName)}</span><span class="stat-value">${cash(totals.costCents)}</span></div>
      <div><span class="stat-label">Calls</span><span class="stat-value">${count(totals.calls)}</span></div>
      <div><span class="stat-label">Tokens in</span><span class="stat-value">${count(totals.inputTokens)}</span></div>
      <div><span class="stat-label">Tokens out</span><span class="stat-value">${count(totals.outputTokens)}</span></div>
    </div>
    ${balance < 100 ? `<p class="small">${balance ? "Your wallet is running low." : "Your wallet is empty."} Add funds before your next call, or calls will be refused.</p>` : ""}
    ${byEndpoint.length ? `<ul class="by-endpoint">${byEndpoint.map(e => `<li><span>${esc(ENDPOINT_TEXT[e.endpoint] ?? e.endpoint)}, ${count(e.calls)} ${e.calls === 1 ? "call" : "calls"}</span><span class="num">${cash(e.costCents)}</span></li>`).join("")}</ul>`
      : `<p class="hint">No calls yet this month.</p>`}
    <div class="usage-actions"><button class="link-btn" type="button" id="usage-refresh">Refresh</button></div>`;
  $("usage-refresh").addEventListener("click", loadUsage);

  $("calls").innerHTML = recent.length ? recent.map(c => `<li>
      <span>${esc(ENDPOINT_TEXT[c.endpoint] ?? c.endpoint)} <span class="key-name">with ${esc(c.keyName)}</span></span>
      <span class="amount">${cash(-c.costCents)}</span>
      <span class="small">${when(c.createdAt)}${c.endpoint === "chat" ? `, ${count(c.inputTokens)} tokens in and ${count(c.outputTokens)} out` : ""}</span>
    </li>`).join("")
    : `<li class="hint">Calls you make with your keys show up here.</li>`;
}
