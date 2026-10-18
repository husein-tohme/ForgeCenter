// Creator pages and creator rewards. Each creator gets a public page at /c/<handle>
// with a bio, links, badges for what they've made, and links to where fans can
// support them (PayPal.me, Ko-fi and so on). Fans pay creators directly on those
// sites; ForgeCenter never holds that money. Creators also earn wallet credit when
// someone they referred pays for a first order by card.
import express from "express";
import { db, now } from "./db.js";
import { isAdmin, isAdult, requireAdmin, requireUser } from "./auth.js";
import { rateLimit } from "./limit.js";
import { addEntry } from "./wallet.js";
import { baseUrl } from "./stripe.js";
import { registerReportTarget } from "./reports.js";
import { payLinksFor } from "./payouts.js";
import { LIVE } from "./games-live.js";

db.exec(`
CREATE TABLE IF NOT EXISTS creator_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  handle TEXT NOT NULL UNIQUE,
  bio TEXT NOT NULL DEFAULT '',
  links TEXT NOT NULL DEFAULT '[]',
  support_links TEXT NOT NULL DEFAULT '{}',
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Who brought whom. One row per referred account; rewarded_order_id is set once,
-- when that account's first card-paid order earns the referrer a reward.
CREATE TABLE IF NOT EXISTS referrals (
  referred_user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  rewarded_order_id INTEGER,
  reward_cents INTEGER
);
CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals(referrer_user_id);
`);

export const LIMITS = { bio: 300, links: 6, label: 30, url: 300 };
const DAY_MS = 24 * 60 * 60 * 1000;
// Orders that were paid at some point (an owner-cancelled order may have been paid too).
const EVER_PAID = "status NOT IN ('awaiting_payment', 'expired', 'payment_failed')";

// ---------- Handles ----------
export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,22})[a-z0-9]$/;
// Names that could pass for the site, its staff or its pages.
const RESERVED = new Set(`admin administrator api support help forgecenter forge-center owner staff mod mods
  moderator official account accounts c creator creators developer developers dev root system team security
  billing wallet shop store login signin sign-in signup sign-up logout settings privacy terms about contact
  null undefined me mine check referral referrals everyone here anthropic claude stripe minecraft mojang`.split(/\s+/));
// Words that can't be part of a handle either, so "forgecenter-team" or "official-steve" are out.
const RESERVED_PARTS = new Set(["admin", "administrator", "forgecenter", "moderator", "official", "staff", "support"]);

export function handleProblem(handle) {
  if (handle.length < 3 || handle.length > 24) return "Handles are 3 to 24 characters long.";
  if (!/^[a-z0-9-]+$/.test(handle)) return "Use only lowercase letters, numbers and hyphens.";
  if (!HANDLE_RE.test(handle)) return "Handles can't start or end with a hyphen.";
  if (RESERVED.has(handle) || handle.split("-").some(p => RESERVED_PARTS.has(p)) || handle.includes("forgecenter")) {
    return "That handle is reserved. Try another one.";
  }
  return null;
}
const cleanHandle = value => String(value ?? "").trim().toLowerCase();
const handleTaken = (handle, userId) =>
  !!db.prepare("SELECT 1 FROM creator_profiles WHERE handle = ? AND user_id != ?").get(handle, userId);

// ---------- Links ----------
function httpUrl(value) {
  const s = String(value ?? "").trim();
  if (!s || s.length > LIMITS.url || /\s/.test(s)) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || !u.hostname.includes(".")) return null;
  return u;
}

// Where fans can pay a creator. Each kind only accepts https links on that service's
// own address, so a support button can't point anywhere else.
const hostIs = (...hosts) => u => hosts.includes(u.hostname) && /^\/[\w.~%/-]+$/.test(u.pathname) && u.pathname !== "/";
export const SUPPORT_KINDS = {
  paypal: { label: "PayPal", example: "https://paypal.me/yourname",
    ok: u => hostIs("paypal.me", "www.paypal.me")(u) || (["www.paypal.com", "paypal.com"].includes(u.hostname) && /^\/paypalme\/[\w.-]+/i.test(u.pathname)) },
  kofi: { label: "Ko-fi", example: "https://ko-fi.com/yourname", ok: hostIs("ko-fi.com", "www.ko-fi.com") },
  patreon: { label: "Patreon", example: "https://www.patreon.com/yourname", ok: hostIs("patreon.com", "www.patreon.com") },
  buymeacoffee: { label: "Buy Me a Coffee", example: "https://buymeacoffee.com/yourname", ok: hostIs("buymeacoffee.com", "www.buymeacoffee.com") },
  github: { label: "GitHub Sponsors", example: "https://github.com/sponsors/yourname", ok: u => u.hostname === "github.com" && /^\/sponsors\/[\w-]+\/?$/i.test(u.pathname) },
  stripe: { label: "Stripe payment link", example: "https://buy.stripe.com/yourlink", ok: hostIs("buy.stripe.com") },
};
const supportKindList = () => Object.entries(SUPPORT_KINDS).map(([key, k]) => ({ key, label: k.label, example: k.example }));

class ProfileError extends Error {
  constructor(message, field, status = 400, extra = {}) { super(message); Object.assign(this, { field, status, extra }); }
}

// Checks everything a creator can edit. Throws a ProfileError naming the field to fix.
function cleanProfile(body, user) {
  const handle = cleanHandle(body?.handle);
  const problem = handleProblem(handle);
  if (problem) throw new ProfileError(problem, "handle");

  // Keep line breaks; drop other control characters.
  const bio = String(body?.bio ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim();
  if (bio.length > LIMITS.bio) throw new ProfileError(`Keep your bio to ${LIMITS.bio} characters or fewer.`, "bio");

  const rawLinks = Array.isArray(body?.links) ? body.links.filter(l => String(l?.url ?? "").trim()) : [];
  if (rawLinks.length > LIMITS.links) throw new ProfileError(`You can add up to ${LIMITS.links} links.`, "links");
  const links = rawLinks.map((l, i) => {
    const u = httpUrl(l.url);
    if (!u) throw new ProfileError(`Link ${i + 1} must be a web address starting with https:// or http://.`, `link-${i}`);
    const label = String(l.label ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (label.length > LIMITS.label) throw new ProfileError(`Keep link names to ${LIMITS.label} characters (link ${i + 1}).`, `link-${i}`);
    return { label: label || u.hostname.replace(/^www\./, ""), url: u.href };
  });

  const support = {};
  for (const [key, kind] of Object.entries(SUPPORT_KINDS)) {
    const value = String(body?.support?.[key] ?? "").trim();
    if (!value) continue;
    const u = httpUrl(value);
    if (!u || u.protocol !== "https:" || u.port || !kind.ok(u)) {
      throw new ProfileError(`That ${kind.label} link doesn't look right. Use a link like ${kind.example}.`, `support-${key}`);
    }
    support[key] = u.href;
  }
  // PayPal, Patreon and the rest need their users to be 18 or older, and strangers
  // sending money to young players is a known grooming route, so only confirmed
  // adults can show support links.
  if (Object.keys(support).length && !isAdult(user)) {
    throw new ProfileError("Support links are for confirmed adults, because the payment sites need you to be 18 or older. Confirm your age to add them.",
      "support", 403, { needs: "adult" });
  }
  return { handle, bio, links, support };
}

const parse = (text, fallback) => { try { return JSON.parse(text) ?? fallback; } catch { return fallback; } };
// Links are checked on the way in; checking again on the way out guards old rows.
const safeLinks = text => parse(text, []).filter(l => httpUrl(l?.url)).slice(0, LIMITS.links)
  .map(l => ({ label: String(l.label ?? "").slice(0, LIMITS.label), url: l.url }));
const supportList = text => {
  const saved = parse(text, {});
  return Object.entries(SUPPORT_KINDS).filter(([key, kind]) => {
    const u = httpUrl(saved[key]);
    return u && u.protocol === "https:" && kind.ok(u);
  }).map(([key, kind]) => ({ kind: key, label: kind.label, url: saved[key] }));
};

// ---------- Badges (worked out from what people made, never stored) ----------
export const BADGES = [
  { key: "maker", name: "Maker", meaning: "Made something with the free creator tools.", earned: s => s.creations > 0 },
  { key: "pixel_artist", name: "Pixel artist", meaning: "Made a texture pack in Texture Forge.", earned: s => s.texturepacks > 0 },
  { key: "pack_builder", name: "Pack builder", meaning: "Put together a modpack in Modpack Forge.", earned: s => s.modpacks > 0 },
  { key: "plugin_smith", name: "Plugin smith", meaning: "Made a server plugin in Plugin Forge.", earned: s => s.plugins > 0 },
  { key: "publisher", name: "Publisher", meaning: "Published a mod on Modrinth.", earned: s => s.published > 0 },
  { key: "showcased", name: "Showcased", meaning: "Has a project live in the ForgeCenter showcase.", earned: s => s.listings > 0 },
  { key: "supporter", name: "Supporter", meaning: "Bought something from ForgeCenter.", earned: s => s.supporter > 0 },
  { key: "recruiter", name: "Recruiter", meaning: "Brought a new customer to ForgeCenter.", earned: s => s.recruits > 0 },
  { key: "donor", name: "Donor", meaning: "Donated to support ForgeCenter and chose to show it.", earned: s => s.donor > 0 },
  { key: "game_launcher", name: "Game launcher", meaning: "Has a game on the ForgeCenter games page.", earned: s => s.launched > 0 },
];
const badgeInfo = ({ key, name, meaning }) => ({ key, name, meaning });
const earnedBadges = stats => BADGES.filter(b => b.earned(stats)).map(badgeInfo);

// Counts behind the badges, for the user in the outer query (aliased u).
const STATS = `
  (SELECT COUNT(*) FROM mods m WHERE m.user_id = u.id) AS creations,
  (SELECT COUNT(*) FROM mods m WHERE m.user_id = u.id AND m.kind = 'texturepack') AS texturepacks,
  (SELECT COUNT(*) FROM mods m WHERE m.user_id = u.id AND m.kind = 'modpack') AS modpacks,
  (SELECT COUNT(*) FROM mods m WHERE m.user_id = u.id AND m.kind = 'plugin') AS plugins,
  (SELECT COUNT(*) FROM mods m WHERE m.user_id = u.id AND m.modrinth_url IS NOT NULL) AS published,
  (SELECT COUNT(*) FROM showcase s WHERE s.user_id = u.id AND s.status = 'approved') AS listings,
  EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status IN ('paid', 'in_progress', 'delivered')) AS supporter,
  (SELECT COUNT(*) FROM referrals r WHERE r.referrer_user_id = u.id AND r.rewarded_order_id IS NOT NULL) AS recruits,
  -- Only donors who chose to show their name on the supporters wall.
  EXISTS (SELECT 1 FROM donations d WHERE d.user_id = u.id AND d.public_name = 1 AND d.paid_at IS NOT NULL AND d.status IN ('paid', 'canceled')) AS donor,
  EXISTS (SELECT 1 FROM games g WHERE g.user_id = u.id AND ${LIVE}) AS launched`;

// Profile rows with only what a public page may show: never email, phone, age group,
// wallet or orders. Accounts closed for being under 13 have no public page.
const PROFILE_SELECT = `SELECT p.user_id, p.handle, p.bio, p.links, p.support_links, p.hidden, p.created_at AS profile_created_at,
    u.name, u.picture, u.created_at AS member_since, u.age_group = 'adult' AS owner_adult, u.suspended_at IS NOT NULL AS owner_suspended, ${STATS}
  FROM creator_profiles p JOIN users u ON u.id = p.user_id
  WHERE COALESCE(u.age_group, '') != 'under13'`;

const profileByHandle = handle => db.prepare(`${PROFILE_SELECT} AND p.handle = ?`).get(handle);
const canSeeHidden = (row, viewer) => !!viewer && (viewer.id === row.user_id || isAdmin(viewer));
const visibleProfile = (handle, viewer) => {
  const row = HANDLE_RE.test(handle) ? profileByHandle(handle) : null;
  return row && ((!row.hidden && !row.owner_suspended) || canSeeHidden(row, viewer)) ? row : null;
};

// WhatsApp accounts start out named "Player 1234" after the end of the phone number,
// which shouldn't be on a public page, so those show the handle instead.
const displayName = row => (/^Player \d{4}$/.test(row.name) ? row.handle : row.name);
const safePicture = url => (typeof url === "string" && /^https:\/\/\S+$/.test(url) ? url : null);

function publicProfile(row, viewer) {
  const owner = viewer?.id === row.user_id;
  const moderator = isAdmin(viewer);
  const creations = db.prepare(`SELECT name, kind, modrinth_url FROM mods WHERE user_id = ? AND modrinth_url IS NOT NULL
    ORDER BY id DESC LIMIT 30`).all(row.user_id)
    .filter(m => httpUrl(m.modrinth_url)).map(m => ({ name: m.name, kind: m.kind, url: m.modrinth_url }));
  const adult = isAdult(viewer);
  const listings = db.prepare(`SELECT title, url, description, adult_only FROM showcase WHERE user_id = ? AND status = 'approved'
    ORDER BY id DESC LIMIT 20`).all(row.user_id)
    .filter(l => httpUrl(l.url) && (!l.adult_only || adult))
    .map(l => ({ title: l.title, url: l.url, description: l.description, adultOnly: !!l.adult_only }));
  return {
    handle: row.handle, name: displayName(row), picture: safePicture(row.picture), bio: row.bio,
    links: safeLinks(row.links), support: row.owner_adult ? supportList(row.support_links) : [],
    badges: earnedBadges(row), memberSince: row.member_since, creations, listings, payLinks: payLinksFor(row.user_id),
    isOwner: owner, canModerate: moderator,
    ...(owner || moderator ? { hidden: !!row.hidden } : {}),
  };
}

// For the /c/<handle> page's title and link preview. Values come back HTML-escaped.
const escapeHtml = s => String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
export function creatorPreview(handle, viewer) {
  const row = visibleProfile(cleanHandle(handle), viewer);
  if (!row) return null;
  const name = displayName(row);
  const bio = row.bio.replace(/\s+/g, " ").trim();
  return {
    handle: row.handle,
    title: escapeHtml(`${name} (@${row.handle}) · ForgeCenter`),
    description: escapeHtml(bio ? (bio.length > 160 ? `${bio.slice(0, 157)}…` : bio) : `${name}'s creator page on ForgeCenter: Minecraft mods, texture packs, modpacks and plugins.`),
  };
}

// ---------- Referrals ----------
function envNumber(name, fallback, min, max) {
  const raw = process.env[name];
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}
export const referralTerms = () => ({
  percent: envNumber("REFERRAL_PERCENT", 10, 0, 50),
  capCents: Math.floor(envNumber("REFERRAL_CAP_CENTS", 5000, 0, 100000)),
});
const firstName = name => String(name ?? "").trim().split(/\s+/)[0].slice(0, 30) || "Someone";
const everPaid = userId => !!db.prepare(`SELECT 1 FROM orders WHERE user_id = ? AND ${EVER_PAID}`).get(userId);

// Called after every payment (orders.js afterPayment). The referrer earns a share of
// a referred account's first order, once, and only when it was paid by card through
// Stripe: wallet-paid orders spend credit that's already on ForgeCenter. The reward
// carries no order id, so the referrer never sees what their referral bought.
export function rewardReferral(order) {
  try {
    if (!order?.user_id || (order.paid_with && order.paid_with !== "card")) return false;
    const referral = db.prepare("SELECT * FROM referrals WHERE referred_user_id = ? AND rewarded_order_id IS NULL").get(order.user_id);
    if (!referral) return false;
    const earlier = db.prepare(`SELECT 1 FROM orders WHERE user_id = ? AND id != ? AND ${EVER_PAID}`).get(order.user_id, order.id);
    if (earlier) return false;
    const { percent, capCents } = referralTerms();
    const cents = Math.min(capCents, Math.floor(((order.amount ?? 0) + (order.monthly ?? 0)) * percent / 100));
    if (cents <= 0) return false;
    const name = db.prepare("SELECT name FROM users WHERE id = ?").get(order.user_id)?.name;
    // A savepoint works inside or outside a transaction the caller may have open.
    db.exec("SAVEPOINT referral_reward");
    try {
      const claimed = db.prepare(`UPDATE referrals SET rewarded_order_id = ?, reward_cents = ?
        WHERE referred_user_id = ? AND rewarded_order_id IS NULL`).run(order.id, cents, order.user_id).changes > 0;
      if (claimed) {
        addEntry({ userId: referral.referrer_user_id, amount: cents, kind: "reward", ref: `referral:${order.id}`,
          note: `${firstName(name)}'s first order through your link` });
      }
      db.exec("RELEASE referral_reward");
      return claimed;
    } catch (e) {
      db.exec("ROLLBACK TO referral_reward");
      db.exec("RELEASE referral_reward");
      throw e;
    }
  } catch (e) {
    // A reward problem must never get in the way of the order itself.
    console.error("Referral reward failed", e.message);
    return false;
  }
}

function referralStats(userId, req) {
  const s = db.prepare(`SELECT COUNT(*) AS referred, COUNT(rewarded_order_id) AS rewarded, COALESCE(SUM(reward_cents), 0) AS earned
    FROM referrals WHERE referrer_user_id = ?`).get(userId);
  const handle = db.prepare("SELECT handle FROM creator_profiles WHERE user_id = ?").get(userId)?.handle;
  return {
    link: handle ? `${baseUrl(req).replace(/\/+$/, "")}/?ref=${handle}` : null,
    referred: s.referred, rewarded: s.rewarded, earnedCents: s.earned, ...referralTerms(),
  };
}

// ---------- Routes ----------
export const creatorsRouter = express.Router();

function mine(req) {
  const row = db.prepare("SELECT * FROM creator_profiles WHERE user_id = ?").get(req.user.id);
  const stats = db.prepare(`SELECT ${STATS} FROM users u WHERE u.id = ?`).get(req.user.id);
  return {
    profile: row ? {
      handle: row.handle, bio: row.bio, links: safeLinks(row.links), support: parse(row.support_links, {}),
      hidden: !!row.hidden, url: `/c/${row.handle}`,
    } : null,
    badges: earnedBadges(stats),
    allBadges: BADGES.map(badgeInfo),
    referral: referralStats(req.user.id, req),
    canAddSupport: isAdult(req.user),
    supportKinds: supportKindList(),
    limits: LIMITS,
  };
}

// The directory: visible creators, best known first (most badges, then most creations).
creatorsRouter.get("/", (req, res) => {
  const rows = db.prepare(`${PROFILE_SELECT} AND p.hidden = 0 AND u.suspended_at IS NULL`).all();
  const list = rows.map(r => ({ row: r, badges: earnedBadges(r) }));
  if (req.query.sort === "new") list.sort((a, b) => b.row.profile_created_at.localeCompare(a.row.profile_created_at) || b.row.user_id - a.row.user_id);
  else list.sort((a, b) => b.badges.length - a.badges.length || b.row.creations - a.row.creations || a.row.user_id - b.row.user_id);
  res.json({
    creators: list.slice(0, 30).map(({ row, badges }) => ({
      handle: row.handle, name: displayName(row), picture: safePicture(row.picture), bio: row.bio,
      badges: badges.map(b => b.key), creations: row.creations,
    })),
    badges: BADGES.map(badgeInfo),
  });
});

creatorsRouter.get("/mine", requireUser, (req, res) => res.json(mine(req)));

creatorsRouter.get("/check", requireUser, rateLimit({ windowMs: 60_000, max: 60 }), (req, res) => {
  const handle = cleanHandle(req.query.handle);
  const problem = handleProblem(handle) ?? (handleTaken(handle, req.user.id) ? "That handle is taken. Try another one." : null);
  res.json(problem ? { ok: false, error: problem } : { ok: true, handle });
});

creatorsRouter.put("/mine", requireUser, rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  let p;
  try { p = cleanProfile(req.body, req.user); }
  catch (e) {
    if (e instanceof ProfileError) return res.status(e.status).json({ error: e.message, field: e.field, ...e.extra });
    throw e;
  }
  if (handleTaken(p.handle, req.user.id)) return res.status(409).json({ error: "That handle is taken. Try another one.", field: "handle" });
  const t = now();
  try {
    db.prepare(`INSERT INTO creator_profiles (user_id, handle, bio, links, support_links, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET handle = excluded.handle, bio = excluded.bio, links = excluded.links,
        support_links = excluded.support_links, updated_at = excluded.updated_at`)
      .run(req.user.id, p.handle, p.bio, JSON.stringify(p.links), JSON.stringify(p.support), t, t);
  } catch (e) {
    // Someone else claimed the handle a moment ago.
    if (/UNIQUE/i.test(e.message)) return res.status(409).json({ error: "That handle is taken. Try another one.", field: "handle" });
    throw e;
  }
  res.json(mine(req));
});

creatorsRouter.delete("/mine", requireUser, (req, res) => {
  // Removing a hidden page and making a new one would undo the hide, so a hidden page
  // stays until the site owner shows it again. Its creator can still clear what's on it.
  if (db.prepare("SELECT hidden FROM creator_profiles WHERE user_id = ?").get(req.user.id)?.hidden) {
    return res.status(409).json({ error: "ForgeCenter has hidden your page, so it can't be removed. You can clear your bio and links, or open a help ticket." });
  }
  db.prepare("DELETE FROM creator_profiles WHERE user_id = ?").run(req.user.id);
  res.json(mine(req));
});

// Links a brand-new account to the creator whose referral link brought it here.
creatorsRouter.post("/referral/claim", requireUser, rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
  const code = cleanHandle(req.body?.code);
  const referrer = HANDLE_RE.test(code) && db.prepare(`SELECT p.user_id, p.handle FROM creator_profiles p JOIN users u ON u.id = p.user_id
    WHERE p.handle = ? AND p.hidden = 0 AND u.suspended_at IS NULL AND COALESCE(u.age_group, '') != 'under13'`).get(code);
  if (!referrer) return res.status(404).json({ error: "That referral link doesn't work any more. Check it with the person who shared it." });
  if (referrer.user_id === req.user.id) return res.status(409).json({ error: "You can't use your own referral link." });
  if (db.prepare("SELECT 1 FROM referrals WHERE referred_user_id = ?").get(req.user.id)) {
    return res.status(409).json({ error: "Your account is already linked to a creator." });
  }
  if (!(Date.now() - Date.parse(req.user.created_at) < DAY_MS)) {
    return res.status(409).json({ error: "Referral links only count for accounts made in the last day." });
  }
  if (everPaid(req.user.id)) return res.status(409).json({ error: "Referral links only count before your first order." });
  const added = db.prepare("INSERT OR IGNORE INTO referrals (referred_user_id, referrer_user_id, created_at) VALUES (?, ?, ?)")
    .run(req.user.id, referrer.user_id, now()).changes;
  if (!added) return res.status(409).json({ error: "Your account is already linked to a creator." });
  res.json({ ok: true, creator: { handle: referrer.handle } });
});

creatorsRouter.get("/:handle", (req, res) => {
  const row = visibleProfile(cleanHandle(req.params.handle), req.user);
  if (!row) return res.status(404).json({ error: "There's no creator page here. Check the link, or find creators on the creators page." });
  res.json({ creator: publicProfile(row, req.user) });
});

// ---------- Owner routes ----------
export const adminCreatorsRouter = express.Router();
adminCreatorsRouter.use(requireUser, requireAdmin);

const adminView = row => ({
  handle: row.handle, userId: row.user_id, name: row.name, email: row.email ?? null, hidden: !!row.hidden,
  bio: row.bio, links: safeLinks(row.links), support: supportList(row.support_links),
  createdAt: row.created_at, updatedAt: row.updated_at,
});
const adminRow = handle => db.prepare(`SELECT p.*, u.name, u.email FROM creator_profiles p JOIN users u ON u.id = p.user_id
  WHERE p.handle = ?`).get(cleanHandle(handle));

adminCreatorsRouter.get("/creators/:handle", (req, res) => {
  const row = adminRow(req.params.handle);
  if (!row) return res.status(404).json({ error: "Creator not found." });
  res.json({ creator: adminView(row) });
});

// Hiding takes a page out of the directory and makes its link show "not found".
adminCreatorsRouter.patch("/creators/:handle", (req, res) => {
  const { hidden } = req.body ?? {};
  if (typeof hidden !== "boolean") return res.status(400).json({ error: "hidden must be true or false." });
  const row = adminRow(req.params.handle);
  if (!row) return res.status(404).json({ error: "Creator not found." });
  db.prepare("UPDATE creator_profiles SET hidden = ?, updated_at = ? WHERE user_id = ?").run(hidden ? 1 : 0, now(), row.user_id);
  res.json({ creator: adminView(adminRow(row.handle)) });
});

// People can report a creator page; the owner can hide it from the reports queue.
registerReportTarget("creator", {
  exists: handle => !!visibleProfile(handle, null),
  describe: handle => {
    const p = HANDLE_RE.test(handle) && db.prepare("SELECT p.user_id, p.handle, p.hidden, u.name FROM creator_profiles p JOIN users u ON u.id = p.user_id WHERE p.handle = ?").get(handle);
    return p && { title: `${p.name} (@${p.handle})`, url: `/c/${p.handle}`, ownerUserId: p.user_id, state: p.hidden ? "hidden" : "visible" };
  },
  hide: handle => db.prepare("UPDATE creator_profiles SET hidden = 1 WHERE handle = ?").run(handle).changes > 0,
});
