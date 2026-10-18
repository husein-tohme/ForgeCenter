// A creator's pay link: shows what you're buying and sends you to Stripe to pay the creator.
import { $, api, esc } from "./common.js";
import { reportButton } from "./report.js";

const params = new URLSearchParams(location.search);
const id = params.get("l");
const box = $("pay");
const usd = c => `$${(c / 100).toFixed(2)}`;

async function show() {
  const r = id && /^\d+$/.test(id) ? await api(`/api/payouts/links/${id}`) : { ok: false, data: { error: "This pay link is missing its number. Check the link with the creator." } };
  if (!r.ok) { box.innerHTML = `<h1 class="page-title">Pay link not found</h1><p>${esc(r.data.error)}</p><a class="btn" href="/creators">Browse creators</a>`; return; }
  const { link } = r.data;
  const by = link.creator.handle ? `<a href="/c/${esc(link.creator.handle)}">${esc(link.creator.name)}</a>` : esc(link.creator.name);
  document.title = `${link.title} · ForgeCenter`;
  box.innerHTML = `
    ${params.get("paid") ? `<p class="note">Payment sent. Thanks! ${esc(link.creator.name)} gets it directly, and Stripe emails you a receipt.</p>` : ""}
    <h1 class="page-title">${esc(link.title)}</h1>
    <p class="small">From ${by}</p>
    ${link.description ? `<p>${esc(link.description)}</p>` : ""}
    <p class="pay-price">${usd(link.amount)}</p>
    <button class="btn btn-buy" type="button" id="pay-btn">Pay ${usd(link.amount)} with Stripe</button>
    <p class="small">You pay ${esc(link.creator.name)} directly. They handle delivery and refunds. ForgeCenter keeps a small fee to run the site. <span id="report-slot"></span></p>`;
  $("report-slot").innerHTML = reportButton("paylink", String(link.id));
  $("pay-btn").addEventListener("click", async e => {
    e.target.disabled = true;
    const c = await api(`/api/payouts/links/${link.id}/checkout`, { method: "POST" });
    if (c.ok) location.href = c.data.url;
    else { e.target.disabled = false; box.insertAdjacentHTML("beforeend", `<p class="error" role="alert">${esc(c.data.error)}</p>`); }
  });
}
show();
