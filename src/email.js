// Email notifications through Resend (resend.com). If RESEND_API_KEY or EMAIL_FROM
// isn't set, emails are skipped and the site works the same without them.
import express from "express";
import { randomBytes } from "node:crypto";
import { db, addColumn, claimedOwnerEmail } from "./db.js";
import { catalog, orbs, usd } from "./catalog.js";

async function resend(message) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, ...message }),
  });
  if (!r.ok) console.error("Email failed", r.status, await r.text().catch(() => ""));
  return r.ok;
}

let transport = resend;
export const setEmailTransport = fn => { transport = fn; };

// Customers can turn off optional emails (updates, replies, thank-yous). Receipts and
// payment problems still arrive, because they're about money already taken. Each
// account gets a random unsubscribe token; the link needs no sign-in.
addColumn("users", "email_optout", "INTEGER NOT NULL DEFAULT 0");
addColumn("users", "email_token", "TEXT");

function unsubscribeUrl(email) {
  const u = db.prepare("SELECT id, email_token FROM users WHERE email = ? COLLATE NOCASE").get(email);
  if (!u) return null;
  let token = u.email_token;
  if (!token) {
    token = randomBytes(18).toString("base64url");
    db.prepare("UPDATE users SET email_token = ? WHERE id = ?").run(token, u.id);
  }
  return `${site()}/api/email/unsubscribe?t=${token}`;
}
const optedOut = email => !!db.prepare("SELECT email_optout FROM users WHERE email = ? COLLATE NOCASE").get(email)?.email_optout;

// Never lets an email problem break the request that triggered it.
function send(to, subject, text, { optional = false } = {}) {
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  for (const address of list) {
    if (optional && optedOut(address)) continue;
    const unsub = unsubscribeUrl(address);
    const message = unsub
      ? { to: [address], subject, text: `${text}\n\n--\nDon't want update emails? Unsubscribe: ${unsub}\nReceipts and payment notices are always sent.`,
          headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }
      : { to: [address], subject, text };
    Promise.resolve()
      .then(() => transport(message))
      .catch(e => console.error("Email failed", e.message));
  }
}

// GET shows a confirm button (so link scanners can't unsubscribe people); POST does it.
// Mail apps' one-click unsubscribe POSTs straight here (RFC 8058).
export const emailRouter = express.Router();
const byToken = t => typeof t === "string" && t.length > 10 ? db.prepare("SELECT id FROM users WHERE email_token = ?").get(t) : null;
emailRouter.get("/unsubscribe", (req, res) => {
  const ok = byToken(req.query.t);
  res.type("html").send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe · ForgeCenter</title><link rel="stylesheet" href="/styles.css"><main class="page"><div class="wrap legal"><h1 class="page-title">Email settings</h1>${ok
    ? `<p>Stop update emails, replies and thank-yous from ForgeCenter? Receipts and payment notices will still arrive.</p><form method="post"><button class="btn btn-buy" type="submit">Unsubscribe</button></form>`
    : `<p>That link has expired. Sign in and open My account to change your email settings.</p>`}</div></main>`);
});
emailRouter.post("/unsubscribe", express.urlencoded({ extended: false, limit: "2kb" }), (req, res) => {
  const u = byToken(req.query.t);
  if (u) db.prepare("UPDATE users SET email_optout = 1 WHERE id = ?").run(u.id);
  res.type("html").send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed · ForgeCenter</title><link rel="stylesheet" href="/styles.css"><main class="page"><div class="wrap legal"><h1 class="page-title">${u ? "You're unsubscribed" : "Link expired"}</h1><p>${u ? "You won't get update emails any more. Turn them back on from My account." : "Sign in and open My account to change your email settings."}</p><a class="btn" href="/">Back to ForgeCenter</a></div></main>`);
});

const site = () => process.env.BASE_URL || "http://localhost:3000";
const owners = () => {
  const list = (process.env.ADMIN_EMAILS || "").split(",").map(s => s.trim()).filter(Boolean);
  const claimed = claimedOwnerEmail();
  return claimed && !list.includes(claimed) ? [...list, claimed] : list;
};
const productName = order => catalog[order.product]?.name ?? order.product;
const customerOf = order => order.user_id ? db.prepare("SELECT email, name FROM users WHERE id = ?").get(order.user_id) : null;
const orderLink = order => `${site()}/account?order=${order.id}`;

export const notify = {
  orderPaid(order) {
    const c = customerOf(order);
    // A game launch has no brief: the game goes on the games page as soon as it's paid.
    if (order.product === "launch") {
      // The game was deleted before payment, or a newer launch replaced this one: this
      // payment won't renew (launchpad.js), so don't tell anyone it's live.
      if (!db.prepare("SELECT 1 FROM games WHERE order_id = ?").get(order.id)) {
        send(owners(), `Launch paid with no game (order ${order.id})`,
          `${c?.name ?? "A creator"} (${c?.email ?? "unknown email"}) paid for a game launch, but the game was deleted or is already live on another launch. It won't renew. Refund it in Stripe if they ask.`);
        return;
      }
      send(owners(), `Game launched (order ${order.id})`,
        `${c?.name ?? "A creator"} (${c?.email ?? "unknown email"}) launched a game on the games page for $1 a month.\n\nSee it on the games page: ${site()}/games\nYou can take a game down from its page if it breaks the rules.`);
      if (c) send(c.email, "Your game is live",
        `Hi ${c.name},\n\nYour game is live on the ForgeCenter games page:\n${site()}/games\n\nIt's $1 a month. You can edit it or cancel any time from My games:\n${site()}/my-games\n\nIf you cancel, it stays up until the end of the month you've paid for, and that month isn't refunded.\n\nForgeCenter`, { optional: true });
      return;
    }
    const withOrbs = order.paid_with === "wallet" ? ` with ${orbs(order.amount)}` : "";
    send(owners(), `New order: ${productName(order)} (order ${order.id})`,
      `${c?.name ?? "A customer"} (${c?.email ?? "unknown email"}) paid for ${productName(order)}${withOrbs}.\n\nOpen the owner panel: ${site()}/admin`);
    if (c) send(c.email, `Thanks for your order: ${productName(order)}`,
      `Hi ${c.name},\n\n${withOrbs ? `You paid for ${productName(order)}${withOrbs}.` : `Your payment for ${productName(order)} went through.`}\n\nNext step: write your project brief so work can start:\n${orderLink(order)}\n\nForgeCenter`);
  },

  paymentFailed(order) {
    const c = customerOf(order);
    if (c) send(c.email, `Payment failed for ${productName(order)}`,
      `Hi ${c.name},\n\nYour latest payment for ${productName(order)} didn't go through. Update your card under Manage billing to keep it running:\n${site()}/account\n\nForgeCenter`);
  },

  statusChanged(order) {
    const c = customerOf(order);
    if (!c) return;
    const lines = {
      in_progress: `Work on your ${productName(order)} has started.`,
      delivered: `Your ${productName(order)} is ready!${order.deliverable_url ? ` Open it here: ${order.deliverable_url}` : ""}`,
      canceled: `Your ${productName(order)} order was canceled. Reply in the order's messages if this is unexpected.`,
    };
    if (lines[order.status]) send(c.email, `Order update: ${productName(order)}`,
      `Hi ${c.name},\n\n${lines[order.status]}\n\nSee the order: ${orderLink(order)}\n\nForgeCenter`, { optional: true });
  },

  provisioningFailed(orderId, reason) {
    send(owners(), `Setup failed for order ${orderId}`,
      `ForgeCenter couldn't set up the server for order ${orderId} after several tries.\n\nLast error: ${reason}\n\nFix the problem, then press Retry in the owner panel: ${site()}/admin`);
  },

  newMessage(order, fromOwner, body) {
    const preview = body.length > 500 ? `${body.slice(0, 500)}…` : body;
    if (fromOwner) {
      const c = customerOf(order);
      if (c) send(c.email, `New message about your ${productName(order)}`,
        `Hi ${c.name},\n\nForgeCenter wrote:\n\n${preview}\n\nReply here: ${orderLink(order)}`, { optional: true });
    } else {
      const c = customerOf(order);
      send(owners(), `Message from ${c?.name ?? "a customer"} (order ${order.id})`,
        `${preview}\n\nReply in the owner panel: ${site()}/admin`);
    }
  },

  underageAccount(user) {
    send(owners(), `Account ${user.id} closed: under 13`,
      `${user.name} (${user.email ?? user.phone ?? "no email"}) said they're under 13. Their account has paid subscriptions or orbs, so it was closed instead of deleted.\n\nCancel and refund their subscriptions in Stripe and refund any unused orb packs to their card. The account stays locked: it can sign in but can't use anything.`);
  },

  walletCredited(userId, cents, reason) {
    const c = db.prepare("SELECT email, name FROM users WHERE id = ?").get(userId);
    if (c) send(c.email, `${orbs(cents)} added to your ForgeCenter account`,
      `Hi ${c.name},\n\nWe added ${orbs(cents)} (worth ${usd(cents)}) to your account for ${reason}. Spend them on anything with a one-time price, or on AI messages once your free ones run out. Orbs never expire.\n\nSee your orbs: ${site()}/account#wallet\n\nForgeCenter`);
  },

  ticketWaiting(ticket) {
    const c = db.prepare("SELECT email, phone, name FROM users WHERE id = ?").get(ticket.user_id);
    send(owners(), `Support ticket ${ticket.id} needs you: ${ticket.subject}`,
      `${c?.name ?? "A customer"} (${c?.email ?? c?.phone ?? "no email"}) needs a person.${ticket.handoff_note ? `\n\nForge Support's note (written by the AI from the customer's messages, so check it before acting): ${ticket.handoff_note}` : ""}\n\nReply in the owner panel: ${site()}/admin#tickets`);
  },

  ticketAnswered(ticket, body) {
    const c = db.prepare("SELECT email, name FROM users WHERE id = ?").get(ticket.user_id);
    const preview = body.length > 500 ? `${body.slice(0, 500)}…` : body;
    if (c) send(c.email, `Reply to your ticket: ${ticket.subject}`,
      `Hi ${c.name},\n\nForgeCenter wrote:\n\n${preview}\n\nReply here: ${site()}/support?ticket=${ticket.id}`, { optional: true });
  },

  // Signed-in donors only; Stripe emails the receipt to everyone who gives.
  donationThanks(donation) {
    const c = donation.user_id ? db.prepare("SELECT email, name FROM users WHERE id = ?").get(donation.user_id) : null;
    if (!c) return;
    const amount = `$${(donation.amount / 100).toLocaleString("en-US")}${donation.monthly ? " a month" : ""}`;
    send(c.email, "Thank you for supporting ForgeCenter",
      `Hi ${c.name},\n\nThank you for your ${amount} donation. It keeps the free tools free and pays for the AI and servers behind them.${donation.monthly
        ? `\n\nYour donation repeats every month. Change your card or cancel any time in Manage billing:\n${site()}/account`
        : ""}\n\nStripe sends your receipt separately.\n\nForgeCenter`, { optional: true });
  },

  topupDisputed(topup, won) {
    const c = topup.user_id ? db.prepare("SELECT email, name FROM users WHERE id = ?").get(topup.user_id) : null;
    const pack = `${orbs(topup.amount)} (${usd(topup.amount)})`;
    send(owners(), won ? `Dispute won: orb pack ${topup.id}` : `Dispute opened: orb pack ${topup.id}`,
      won
        ? `The card dispute on ${c?.name ?? "a customer"}'s ${pack} orb pack closed in your favour, so the orbs went back into their account.`
        : `${c?.name ?? "A customer"} (${c?.email ?? "no email"}) disputed a ${pack} orb pack with their bank. Those orbs were taken out of their account, which may now be below zero. Respond to the dispute in the Stripe Dashboard.`);
  },
};
