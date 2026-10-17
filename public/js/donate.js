import { $, api, esc, icon, registerIcons, money, date, toast, onUser, getUser, ready, requireSignIn } from "./common.js";

const HEART = ["........", ".rr..rr.", "rwrrrrrR", "rwrrrrrR", "rrrrrrRR", ".rrrrRR.", "..rrRR..", "...RR..."];
registerIcons({
  heart: { c: { r: "#d9372b", w: "#ff9a8f", R: "#8e1a12" }, m: HEART },
  goldheart: { c: { r: "#f2c230", w: "#fff1a8", R: "#a8780a" }, m: HEART },
});

const PRESETS = [100, 300, 500, 1000, 2500];
let limits = { min: 100, max: 50000 };
let available = true;

const params = new URLSearchParams(location.search);
const thanked = params.get("thanks") === "1";
const returnedId = Number(params.get("donation")) || null;
// Read once; drop them so a reload doesn't repeat the thank-you.
if (params.has("thanks") || params.has("donation")) {
  params.delete("thanks"); params.delete("donation");
  history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "") + location.hash);
}

const form = $("donate-form");
$("thanks-icon").innerHTML = icon("heart");
$("chip-row").innerHTML = PRESETS.map(c => `<label class="chip-radio">
  <input type="radio" name="amount" value="${c}" ${c === 500 ? "checked" : ""}><span>${money(c)}</span></label>`).join("");

// ---------- Amount and frequency ----------
const isMonthly = () => form.elements.frequency.value === "monthly";
function amount() {
  const other = $("other").value.trim();
  if (other) return Number(other) * 100;
  const picked = form.querySelector("input[name=amount]:checked");
  return picked ? Number(picked.value) : null;
}
const validAmount = cents => Number.isInteger(cents) && cents % 100 === 0 && cents >= limits.min && cents <= limits.max;
const amountError = () => `Choose a whole-dollar amount from ${money(limits.min)} to ${money(limits.max)}.`;

function showError(text) { $("donate-error").textContent = text; $("donate-error").hidden = !text; }

function update() {
  const user = getUser();
  const cents = amount();
  // The amount in the hyperlegible face: the pixel font draws a 5 like an S.
  const label = validAmount(cents) ? `<span class="num">${money(cents)}</span>` : "";
  const monthly = isMonthly();
  $("monthly-note").hidden = !(monthly && !user);
  $("off-note").hidden = available;
  const btn = $("donate-btn");
  btn.disabled = !available;
  if (monthly && !user) btn.innerHTML = label ? `Sign in to give ${label} a month` : "Sign in to give monthly";
  else if (monthly) btn.innerHTML = label ? `Donate ${label} a month` : "Donate monthly";
  else btn.innerHTML = label ? `Donate ${label}` : "Donate";
}

form.addEventListener("change", e => {
  if (e.target.name === "amount") $("other").value = "";
  showError("");
  update();
});
$("other").addEventListener("input", () => {
  if ($("other").value) form.querySelectorAll("input[name=amount]").forEach(r => { r.checked = false; });
  showError("");
  update();
});

form.addEventListener("submit", e => {
  e.preventDefault();
  const cents = amount();
  if (!validAmount(cents)) return showError(amountError());
  showError("");
  const give = async () => {
    const btn = $("donate-btn");
    btn.disabled = true;
    const r = await api("/api/donations", { method: "POST", body: {
      amount: cents, monthly: isMonthly(), showName: !!getUser() && $("show-name").checked } });
    if (r.data.url) { location.href = r.data.url; return; }
    btn.disabled = false;
    if (r.data.needs === "birthday") return; // the birthday question opens by itself
    showError(r.data.error || "Checkout couldn't start. Try again in a moment.");
  };
  // Monthly donations are cancelled from the account, so they need one.
  if (isMonthly()) requireSignIn(give); else give();
});

api("/api/donations/options").then(r => {
  if (r.ok) ({ available, limits } = r.data);
  $("other").min = limits.min / 100;
  $("other").max = limits.max / 100;
  update();
});

onUser(user => {
  $("show-name-row").hidden = !user;
  $("signed-out-name").hidden = !!user;
  if (user) $("my-name").textContent = user.name;
  update();
  if (user?.ageGroup && user.ageGroup !== "under13") loadMine();
  else $("yours").hidden = true;
});

// ---------- Back from Stripe ----------
const RECEIPT = "Stripe emails your receipt.";
const STATUS_TEXT = {
  paid: d => d.monthly
    ? `Your ${money(d.amount)} monthly donation is set up. ${RECEIPT.replace(".", " each month.")}${d.showName ? " Your name is on the supporters wall." : ""}`
    : `Your ${money(d.amount)} donation went through. ${RECEIPT}${d.showName ? " Your name is on the supporters wall." : ""}`,
  awaiting_payment: (_d, waiting) => waiting ? "Confirming your payment…"
    : "Your payment is still going through. Bank payments can take a few days, and there's nothing more you need to do.",
  payment_failed: () => "Your payment didn't go through, so nothing was charged. Try again with a different payment method.",
  expired: () => "Checkout closed before payment, so nothing was charged.",
};

function showThanks() {
  $("donate-box").hidden = true;
  $("thanks").hidden = false;
  $("thanks-status").textContent = RECEIPT;
  ready.then(() => { if (returnedId && getUser()?.ageGroup) checkReturn(0); });
}

async function checkReturn(polls) {
  const r = await api(`/api/donations/${returnedId}`);
  if (!r.ok) return;
  const d = r.data.donation;
  const waiting = d.status === "awaiting_payment" && polls < 5;
  const failed = ["payment_failed", "expired"].includes(d.status);
  $("thanks-title").textContent = failed ? "Nothing was charged" : "Thank you!";
  $("thanks-icon").innerHTML = icon(failed ? "barrier" : d.monthly ? "goldheart" : "heart");
  $("thanks-text").hidden = failed;
  $("give-again").textContent = failed ? "Try again" : "Give again";
  $("thanks-status").textContent = STATUS_TEXT[d.status]?.(d, waiting) ?? RECEIPT;
  // The webhook usually lands within a few seconds of coming back.
  if (waiting) setTimeout(() => checkReturn(polls + 1), 2500);
  if (d.status === "paid") { loadWall(); loadMine(); }
}

$("give-again").addEventListener("click", () => {
  $("thanks").hidden = true;
  $("donate-box").hidden = false;
  form.querySelector("input[name=amount]:checked, #other")?.focus();
});

if (thanked) showThanks();

// ---------- Supporters wall ----------
async function loadWall() {
  const r = await api("/api/donations/wall");
  const list = r.data.supporters ?? [];
  $("wall").innerHTML = !r.ok ? `<li class="hint">The wall couldn't load. Refresh the page to try again.</li>`
    : list.length ? list.map(s => `<li class="tag${s.monthly ? " tag-monthly" : ""}">
        <span class="tag-name">${esc(s.name)}</span>${s.monthly ? `<span class="tag-sub">Monthly supporter</span>` : ""}</li>`).join("")
    : `<li class="hint">No names here yet. Sign in and tick "Show my name" when you donate to be the first.</li>`;
}
loadWall();

// ---------- The signed-in donor's own donations ----------
function describe(d) {
  if (!d.monthly) return `One time, ${date(d.paidAt)}`;
  if (d.status === "canceled") return `Monthly, ended ${date(d.endsAt ?? d.paidAt)}`;
  if (d.overdue) return `Monthly since ${date(d.paidAt)}. The last payment didn't go through: update your card in Manage billing`;
  if (d.endsAt) return `Monthly since ${date(d.paidAt)}, ends ${date(d.endsAt)}`;
  return `Monthly since ${date(d.paidAt)}`;
}
function statePill(d) {
  const [label, tone] = !d.monthly ? ["Received", "done"]
    : d.status === "canceled" ? ["Ended", "muted"] : d.overdue ? ["Payment failed", "wait"] : d.endsAt ? ["Ending", "wait"] : ["Active", "done"];
  return `<span class="pill pill-${tone}">${label}</span>`;
}

async function loadMine() {
  const r = await api("/api/donations/mine");
  const donations = r.data.donations ?? [];
  $("yours").hidden = !donations.length;
  if (!donations.length) return;
  $("your-list").innerHTML = donations.map(d => `<li>
      <span class="slot">${icon(d.monthly ? "goldheart" : "heart")}</span>
      <span class="your-main"><strong class="num">${money(d.amount)}${d.monthly ? " a month" : ""}</strong><span class="small">${esc(describe(d))}</span></span>
      ${statePill(d)}</li>`).join("");
  const monthly = donations.some(d => d.monthly && d.status === "paid");
  $("your-billing").innerHTML = monthly ? `<p class="small">Change your card or cancel your monthly donation any time in Manage billing.</p>
    <a class="btn btn-small" href="/account">Manage billing on your account</a>` : "";
  $("wall-toggle").checked = r.data.onWall;
}

$("wall-toggle").addEventListener("change", async e => {
  const showName = e.target.checked;
  const r = await api("/api/donations/mine", { method: "PATCH", body: { showName } });
  if (!r.ok) { e.target.checked = !showName; return toast(r.data.error); }
  e.target.checked = r.data.onWall;
  toast(r.data.onWall ? "Your name is on the supporters wall." : "Your name is off the supporters wall.");
  loadWall();
});
