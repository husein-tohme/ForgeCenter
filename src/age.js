// Adult confirmation for teen accounts. The birthday question (auth.js) makes 18+ people adults; teens who turn 18
// confirm with a credit card check (Stripe Checkout in setup mode: card issuers only
// give credit cards to adults) or an ID scan with a selfie (Stripe Identity).
// ForgeCenter keeps only the outcome: never card details, a date of birth or ID
// images. The card is removed after the check, and Identity sessions are redacted at
// Stripe as soon as the result is read.
import express from "express";
import { db, now } from "./db.js";
import { ageOn, publicUser, requireUser } from "./auth.js";
import { rateLimit } from "./limit.js";
import { getStripe, ensureCustomer, baseUrl, CHECKOUT_LABELS, checkoutKind } from "./stripe.js";

export const ADULT_AGE = 18;
const DAILY_CHECKS = 5; // ID scans cost money, so keep retries sensible

// What each failure means for the person, keyed by our reason or Stripe's error code.
const REASONS = {
  card_debit: "That was a debit card. Only credit cards show you're an adult, so try a credit card or scan your ID.",
  card_prepaid: "That was a prepaid card. Only credit cards show you're an adult, so try a credit card or scan your ID.",
  card_unknown: "We couldn't tell what kind of card that was. Try a different credit card or scan your ID.",
  not_a_card: "That wasn't a card. Use a credit card or scan your ID instead.",
  card_not_verified: "Your bank didn't confirm the card. Try another credit card or scan your ID.",
  under_18: "Your ID shows you're under 18, so your account stays in the teen group.",
  no_birth_date: "We couldn't read a date of birth from your ID. Try again with a different ID.",
  document_expired: "That ID has expired. Try again with a current one.",
  document_type_not_supported: "That kind of ID isn't supported. Try a passport, driving licence or national ID card.",
  selfie_face_mismatch: "The selfie didn't match the photo on your ID. Try again in good light.",
  consent_declined: "The ID scan was stopped before it finished. Start again whenever you're ready.",
  abandoned: "The ID scan was stopped before it finished. Start again whenever you're ready.",
  canceled: "The check was stopped before it finished. Start again whenever you're ready.",
  expired: "The check timed out before it finished. Start again whenever you're ready.",
  replaced: "You started a newer check.",
};
const reasonText = reason => REASONS[reason]
  ?? (reason?.startsWith("selfie_") ? "Your selfie couldn't be checked. Try again in good light."
    : "Your age couldn't be confirmed. Try again, or use the other method.");

const publicCheck = c => c && ({
  id: c.id, method: c.method, status: c.status, createdAt: c.created_at,
  message: c.status === "failed" ? reasonText(c.reason) : null,
});

const getCheck = id => db.prepare("SELECT * FROM age_checks WHERE id = ?").get(Number(id));
const checkFor = (stripeId, method) => db.prepare("SELECT * FROM age_checks WHERE stripe_id = ? AND method = ?").get(stripeId, method);

function finish(check, passed, reason = null) {
  // Only a pending check can finish, so replayed or late events change nothing.
  const r = db.prepare("UPDATE age_checks SET status = ?, reason = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
    .run(passed ? "passed" : "failed", passed ? null : reason, now(), check.id);
  if (r.changes && passed) {
    db.prepare(`UPDATE users SET age_group = 'adult', age_method = ?, age_confirmed_at = ?
      WHERE id = ? AND age_group IS NOT 'under13'`).run(check.method, now(), check.user_id);
  }
}

// ---------- Credit card check ----------
async function completeCardCheck(session) {
  const check = checkFor(session.id, "credit_card");
  if (!check || check.status !== "pending") return;
  if (session.status === "expired") return finish(check, false, "expired");
  if (session.status !== "complete" || !session.setup_intent) return;
  const stripe = getStripe();
  const siId = typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent.id;
  const si = await stripe.setupIntents.retrieve(siId, { expand: ["payment_method"] });
  const pm = si.payment_method;
  // The card was only needed for the check, so it isn't kept on the account.
  if (pm?.id) await stripe.paymentMethods.detach(pm.id).catch(e => console.error("Couldn't remove the age-check card", e.message));
  if (si.status !== "succeeded") return finish(check, false, "card_not_verified");
  if (pm?.type !== "card") return finish(check, false, "not_a_card");
  const funding = pm.card?.funding;
  finish(check, funding === "credit", `card_${funding ?? "unknown"}`);
}

// ---------- ID scan ----------
async function completeIdCheck(sessionId, { forAgeCheck = false } = {}) {
  const check = checkFor(sessionId, "id_scan");
  // No row: the account was deleted mid-check. The data at Stripe still has to go.
  if (!check && !forAgeCheck) return;
  const stripe = getStripe();
  const pending = check?.status === "pending";
  const vs = await stripe.identity.verificationSessions.retrieve(sessionId, pending ? { expand: ["verified_outputs.dob"] } : {});
  if (pending) {
    if (vs.status === "verified") {
      const dob = vs.verified_outputs?.dob;
      // A missing month or day counts as the end of the year, so nobody passes early.
      if (!dob?.year) finish(check, false, "no_birth_date");
      else finish(check, ageOn(new Date(), dob.year, dob.month ?? 12, dob.day ?? 31) >= ADULT_AGE, "under_18");
    } else if (vs.status === "requires_input" && vs.last_error?.code) {
      finish(check, false, vs.last_error.code === "under_supported_age" ? "under_18" : vs.last_error.code);
    } else if (vs.status === "canceled") {
      return finish(check, false, "canceled");
    } else {
      return; // still processing, or not submitted yet
    }
  }
  // The outcome is saved (or the check was replaced or its account deleted), so have
  // Stripe delete the ID images and personal details. A failure throws, so the webhook
  // answers 500 and Stripe tries again.
  if (["verified", "requires_input"].includes(vs.status) && !vs.redaction) {
    await stripe.identity.verificationSessions.redact(sessionId);
  }
}

// Webhook events for age checks: Checkout Sessions with kind age_check, and Identity.
export async function handleAgeEvent(event) {
  const obj = event.data.object;
  if (event.type.startsWith("identity.verification_session.")) {
    return completeIdCheck(obj.id, { forAgeCheck: obj.metadata?.kind === "age_check" });
  }
  if (checkoutKind(obj) !== "age_check") return;
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.expired") return completeCardCheck(obj);
}

// Catches up when someone comes back before the webhook has arrived.
async function sync(check) {
  const stripe = getStripe();
  if (!stripe || check.status !== "pending" || !check.stripe_id) return;
  if (check.method === "credit_card") await completeCardCheck(await stripe.checkout.sessions.retrieve(check.stripe_id));
  else await completeIdCheck(check.stripe_id).catch(e => console.error("Identity sync failed", e.message));
}

// ---------- Routes ----------
export const ageRouter = express.Router();

const freshUser = id => db.prepare("SELECT * FROM users WHERE id = ?").get(id);

ageRouter.get("/", requireUser, async (req, res) => {
  const wanted = Number(req.query.check) || null;
  let check = wanted
    ? db.prepare("SELECT * FROM age_checks WHERE id = ? AND user_id = ?").get(wanted, req.user.id)
    : db.prepare("SELECT * FROM age_checks WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(req.user.id);
  if (check?.status === "pending") {
    try { await sync(check); } catch (e) { console.error("Age check sync failed", e.message); }
    check = getCheck(check.id);
  }
  res.json({ user: publicUser(freshUser(req.user.id)), check: publicCheck(check), available: !!getStripe() });
});

// Shared checks before starting either method.
function canStart(req, res, next) {
  if (req.user.age_group === "adult") return res.status(409).json({ error: "Your age is already confirmed." });
  if (!getStripe()) return res.status(503).json({ error: "Age checks aren't set up yet." });
  const today = new Date().toISOString().slice(0, 10);
  const started = db.prepare("SELECT COUNT(*) AS n FROM age_checks WHERE user_id = ? AND created_at >= ?").get(req.user.id, today).n;
  if (started >= DAILY_CHECKS) return res.status(429).json({ error: "You've tried several times today. Try again tomorrow." });
  next();
}

function newCheck(userId, method) {
  // A newer check replaces any unfinished one, so only one can ever pass.
  db.prepare("UPDATE age_checks SET status = 'failed', reason = 'replaced', updated_at = ? WHERE user_id = ? AND status = 'pending'")
    .run(now(), userId);
  const t = now();
  return Number(db.prepare("INSERT INTO age_checks (user_id, method, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(userId, method, t, t).lastInsertRowid);
}

const returnUrl = (req, id) => `${baseUrl(req)}/account?age_check=${id}#age`;

ageRouter.post("/card", requireUser, rateLimit({ windowMs: 60_000, max: 5 }), canStart, async (req, res) => {
  // An ID that showed someone is under 18 outweighs a card, which could be a parent's.
  const idSaysMinor = db.prepare("SELECT 1 FROM age_checks WHERE user_id = ? AND method = 'id_scan' AND reason = 'under_18'").get(req.user.id);
  if (idSaysMinor) return res.status(403).json({ error: REASONS.under_18 });
  const stripe = getStripe();
  const id = newCheck(req.user.id, "credit_card");
  try {
    const metadata = { kind: "age_check", check_id: String(id), user_id: String(req.user.id) };
    const session = await stripe.checkout.sessions.create({
      mode: "setup", currency: "usd", customer: await ensureCustomer(stripe, req.user),
      metadata, setup_intent_data: { metadata },
      custom_text: { submit: { message: "This only checks that you're an adult. You won't be charged and the card isn't saved. Your bank may show a small temporary hold that disappears on its own." } },
      success_url: returnUrl(req, id), cancel_url: `${baseUrl(req)}/account#age`,
      // Just over Stripe's 30-minute minimum, so an abandoned checkout clears quickly.
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      integration_identifier: CHECKOUT_LABELS.ageCheck,
    });
    db.prepare("UPDATE age_checks SET stripe_id = ? WHERE id = ?").run(session.id, id);
    res.json({ url: session.url });
  } catch (e) {
    db.prepare("DELETE FROM age_checks WHERE id = ?").run(id);
    console.error("Card age check failed to start", e.message);
    res.status(502).json({ error: "The card check couldn't start. Try again in a moment." });
  }
});

ageRouter.post("/id", requireUser, rateLimit({ windowMs: 60_000, max: 5 }), canStart, async (req, res) => {
  const stripe = getStripe();
  const id = newCheck(req.user.id, "id_scan");
  try {
    const vs = await stripe.identity.verificationSessions.create({
      type: "document",
      options: { document: { require_matching_selfie: true, require_live_capture: true } },
      client_reference_id: `user_${req.user.id}`,
      metadata: { kind: "age_check", check_id: String(id), user_id: String(req.user.id) },
      return_url: returnUrl(req, id),
    });
    db.prepare("UPDATE age_checks SET stripe_id = ? WHERE id = ?").run(vs.id, id);
    res.json({ url: vs.url });
  } catch (e) {
    db.prepare("DELETE FROM age_checks WHERE id = ?").run(id);
    console.error("ID age check failed to start", e.message);
    res.status(502).json({ error: "The ID scan couldn't start. Try again in a moment, or use a credit card." });
  }
});
