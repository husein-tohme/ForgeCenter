// The "Report" button and its dialog. Any page can drop reportButton(type, id) into its
// HTML; one click handler here opens the dialog for whichever button was pressed.
import { $, api, esc, toast, requireSignIn } from "./common.js";

const REASONS = [
  ["scam", "Scam or phishing", "Fake giveaways, fake logins, asking for passwords or money."],
  ["inappropriate", "Inappropriate or 18+ content", "Sexual content, or adult content that isn't marked 18+."],
  ["stolen", "Stolen or reuploaded work", "Someone else's mod, map, pack or code posted as theirs."],
  ["harassment", "Harassment or hate", "Bullying, threats, or sharing someone's personal info."],
  ["spam", "Spam", "Ads, repeated posts or links that go somewhere else."],
  ["other", "Something else", "Malware, cheats, impersonation or another rule."],
];
const NOUN = { listing: "listing", creator: "creator page", game: "game", assistant: "assistant" };

// The dialog's own styles, added once to whichever page uses it.
if (!document.querySelector('link[href="/css/reports.css"]')) {
  document.head.insertAdjacentHTML("beforeend", `<link rel="stylesheet" href="/css/reports.css">`);
}

export const reportButton = (type, id) =>
  `<button class="link-btn report-btn" type="button" data-report-type="${esc(type)}" data-report-id="${esc(id)}">Report</button>`;

function reportDialog() {
  document.body.insertAdjacentHTML("beforeend", `
    <dialog class="panel gate report-dialog" id="report-dialog" aria-labelledby="report-title">
      <h2 id="report-title">Report this</h2>
      <p class="small">Reports go to a person at ForgeCenter, not to the person you're reporting. See the <a href="/rules" target="_blank">ForgeCenter rules</a>.</p>
      <form id="report-form">
        <fieldset class="report-reasons">
          <legend>What's wrong?</legend>
          ${REASONS.map(([value, label, help]) => `
          <label class="report-reason"><input type="radio" name="reason" value="${value}" required>
            <span><strong>${label}</strong><span class="small">${help}</span></span></label>`).join("")}
        </fieldset>
        <label class="report-details">Anything else we should know? <span class="small">(optional)</span>
          <textarea name="details" rows="3" maxlength="1000" placeholder="What happened, and where to look"></textarea></label>
        <p class="error" id="report-error" role="alert" hidden></p>
        <div class="report-actions">
          <button class="btn btn-buy" type="submit">Send report</button>
          <button class="btn" type="button" id="report-cancel">Cancel</button>
        </div>
      </form>
    </dialog>`);
  const d = $("report-dialog");
  $("report-cancel").addEventListener("click", () => d.close());
  $("report-form").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target.elements;
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true;
    const r = await api("/api/reports", { method: "POST", body: {
      type: d.dataset.type, id: d.dataset.id, reason: f.reason.value, details: f.details.value.trim() } });
    btn.disabled = false;
    if (r.ok) { d.close(); toast("Thanks. Your report was sent, and a person will look at it."); return; }
    if (r.data.needs === "birthday" || r.data.needs === "suspended") { d.close(); return; }
    $("report-error").textContent = r.data.error || "The report couldn't be sent. Try again in a moment.";
    $("report-error").hidden = false;
  });
  return d;
}

export function openReport(type, id) {
  return requireSignIn(() => {
    const d = $("report-dialog") ?? reportDialog();
    d.dataset.type = type; d.dataset.id = id;
    $("report-title").textContent = `Report this ${NOUN[type] ?? "item"}`;
    $("report-form").reset();
    $("report-error").hidden = true;
    if (!d.open) d.showModal();
  });
}

document.addEventListener("click", e => {
  const b = e.target.closest("[data-report-type]");
  if (!b) return;
  e.preventDefault();
  openReport(b.dataset.reportType, b.dataset.reportId);
});
