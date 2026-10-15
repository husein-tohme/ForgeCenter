// Small in-memory rate limiter, keyed by signed-in user or IP address.
export function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, v] of hits) if (v.start < cutoff) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const key = req.user?.id ? `u${req.user.id}` : `ip${req.ip}`;
    const t = Date.now();
    let entry = hits.get(key);
    if (!entry || t - entry.start > windowMs) entry = { start: t, count: 0 };
    entry.count++;
    hits.set(key, entry);
    if (entry.count > max) return res.status(429).json({ error: "Too many requests. Wait a minute and try again." });
    next();
  };
}
