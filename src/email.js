// Email notifications through Resend (resend.com). If RESEND_API_KEY or EMAIL_FROM
// isn't set, emails are skipped and the site works the same without them.
import { db } from "./db.js";
import { catalog } from "./catalog.js";

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

// Never lets an email problem break the request that triggered it.
function send(to, subject, text) {
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!list.length) return;
  Promise.resolve()
    .then(() => transport({ to: list, subject, text }))
    .catch(e => console.error("Email failed", e.message));
}

const site = () => process.env.BASE_URL || "http://localhost:3000";
const owners = () => (process.env.ADMIN_EMAILS || "").split(",").map(s => s.trim()).filter(Boolean);
const productName = order => catalog[order.product]?.name ?? order.product;
const customerOf = order => order.user_id ? db.prepare("SELECT email, name FROM users WHERE id = ?").get(order.user_id) : null;
const orderLink = order => `${site()}/account?order=${order.id}`;

export const notify = {
  orderPaid(order) {
    const c = customerOf(order);
    send(owners(), `New order: ${productName(order)} (order ${order.id})`,
      `${c?.name ?? "A customer"} (${c?.email ?? "unknown email"}) paid for ${productName(order)}.\n\nOpen the owner panel: ${site()}/admin`);
    if (c) send(c.email, `Thanks for your order: ${productName(order)}`,
      `Hi ${c.name},\n\nYour payment for ${productName(order)} went through.\n\nNext step: write your project brief so work can start:\n${orderLink(order)}\n\nForgeCenter`);
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
      `Hi ${c.name},\n\n${lines[order.status]}\n\nSee the order: ${orderLink(order)}\n\nForgeCenter`);
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
        `Hi ${c.name},\n\nForgeCenter wrote:\n\n${preview}\n\nReply here: ${orderLink(order)}`);
    } else {
      const c = customerOf(order);
      send(owners(), `Message from ${c?.name ?? "a customer"} (order ${order.id})`,
        `${preview}\n\nReply in the owner panel: ${site()}/admin`);
    }
  },

  underageAccount(user) {
    send(owners(), `Account ${user.id} closed: under 13`,
      `${user.name} (${user.email ?? user.phone ?? "no email"}) said they're under 13. Their account has paid subscriptions or wallet credit, so it was closed instead of deleted.\n\nCancel and refund their subscriptions in Stripe and refund any wallet credit. The account stays locked: it can sign in but can't use anything.`);
  },

  walletCredited(userId, cents, reason) {
    const c = db.prepare("SELECT email, name FROM users WHERE id = ?").get(userId);
    if (c) send(c.email, `$${(cents / 100).toFixed(2)} added to your ForgeCenter wallet`,
      `Hi ${c.name},\n\nWe added $${(cents / 100).toFixed(2)} to your wallet for ${reason}. You can spend it on anything with a one-time price.\n\nSee your wallet: ${site()}/account#wallet\n\nForgeCenter`);
  },

  ticketWaiting(ticket) {
    const c = db.prepare("SELECT email, phone, name FROM users WHERE id = ?").get(ticket.user_id);
    send(owners(), `Support ticket ${ticket.id} needs you: ${ticket.subject}`,
      `${c?.name ?? "A customer"} (${c?.email ?? c?.phone ?? "no email"}) needs a person.${ticket.handoff_note ? `\n\n${ticket.handoff_note}` : ""}\n\nReply in the owner panel: ${site()}/admin#tickets`);
  },

  ticketAnswered(ticket, body) {
    const c = db.prepare("SELECT email, name FROM users WHERE id = ?").get(ticket.user_id);
    const preview = body.length > 500 ? `${body.slice(0, 500)}…` : body;
    if (c) send(c.email, `Reply to your ticket: ${ticket.subject}`,
      `Hi ${c.name},\n\nForgeCenter wrote:\n\n${preview}\n\nReply here: ${site()}/support?ticket=${ticket.id}`);
  },
};
