// Fetching a random safe-for-work meme from https://meme-api.com (a free public Reddit meme API).

const IMAGE_URL = /^https:\/\/\S+\.(png|jpe?g|gif|webp)$/i;

/** Picks the first meme that is not NSFW, not a spoiler and is a direct image link. */
export function pickSafeMeme(memes) {
  for (const meme of memes ?? []) {
    if (!meme || meme.nsfw !== false || meme.spoiler) continue;
    if (typeof meme.url !== "string" || !IMAGE_URL.test(meme.url)) continue;
    return {
      title: String(meme.title ?? "Meme").slice(0, 256),
      url: meme.url,
      postLink: typeof meme.postLink === "string" ? meme.postLink : null,
      subreddit: String(meme.subreddit ?? ""),
      ups: Number(meme.ups) || 0,
    };
  }
  return null;
}

/**
 * Fetches a handful of memes from one of the given subreddits and returns a safe one, or null.
 * Throws on network errors or timeouts; the /meme command turns that into a friendly message.
 */
export async function fetchMeme({ subreddits, fetchImpl = fetch, timeoutMs = 8000, rng = Math.random }) {
  const subreddit = subreddits[Math.floor(rng() * subreddits.length)];
  const res = await fetchImpl(`https://meme-api.com/gimme/${encodeURIComponent(subreddit)}/10`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Meme API answered ${res.status}`);
  const body = await res.json();
  return pickSafeMeme(Array.isArray(body?.memes) ? body.memes : [body]);
}
