# 4, Block 4. Content

How the Academy finds, sorts, rates and keeps alive about 2 million links (videos, docs, repos and example sites), how it handles uploads, and how its own lessons and docs stay correct.

## Where content comes from

| Source | What we take | How |
|---|---|---|
| YouTube | Video ID, title, description, chapters, length, channel, thumbnail | YouTube Data API, plus the free channel feeds for new uploads |
| Uploads | The whole video, analysed fully by the AI | Uploaded straight to a video service (Cloudflare Stream or Mux) |
| Creators who join | Their whole channel, analysed fully | They connect their channel and agree to analysis |
| Official docs (MDN, Python docs, Rust book and so on) | Links, titles and short quotes where the licence allows | A polite crawler that follows each site's `robots.txt` |
| GitHub | Example and companion repos | GitHub API; code is only shown when its licence allows |
| Example websites | Live sites that show a technique well | Curated by people, checked automatically |
| Students and teachers | Suggested links | A "suggest a video or link" button, reviewed like everything else |

### Living within YouTube's limits

- **Searching is expensive.** Each YouTube search uses 100 of the default 10,000 daily API units, so search is used sparingly, for gaps only.
- **Channels are cheap.** Reading a channel's uploads costs 1 unit per 50 videos, so discovery starts from a list of good coding channels and grows from there.
- **New uploads are free to spot.** Every channel has a public feed of its latest videos.
- **Checking is cheap.** Looking up 50 videos costs 1 unit, so checking 1.5 million videos takes about 30,000 units. Spread over 30 days, that's about 1,000 units a day.
- **Ask YouTube for more.** Once the site is live, apply for a higher limit through YouTube's API audit.
- **Follow YouTube's developer policies:** refresh stored video details at least every 30 days, use the official player without hiding or changing it, and show that the video is from YouTube and who made it.

## The pipeline

1. **Discover** a link.
2. **Remove duplicates:** the same video ID, or the same page under a different address, is stored once.
3. **Sort it.** The AI reads the title, description and chapters (plus the transcript for uploads and joined creators) and tags the languages, topics, level and language version.
4. **Pre-score it** on clarity signals: chapters, length, audio quality where known, the creator's track record, how recent it is.
5. **Place it** under its topics as a candidate.
6. **Students watch, rate and mark** "helped" and "skip" moments.
7. **Rank it** (below), so the best rise to the top 2–3.

## Ranking

- **Fair stars.** A video with one 5-star rating shouldn't beat one with 400 ratings averaging 4.8, so star scores start from the topic's average and move as ratings arrive.
- **What it's built from:** stars, tags ("Clear", "Outdated"), how many people finish it, whether students pass the quiz after watching it, "helped" marks, freshness and the creator's track record.
- **Separate for each level:** beginners, hobby coders and professionals each get their own ranking.
- **New videos get a fair chance.** A small share of students sees promising new videos, so they can earn ratings instead of being stuck below the old favourites forever.
- **No paying for placement.** Sponsored tracks are labelled and never change video rankings.

## Keeping 2 million links alive

| Link | Checked |
|---|---|
| Top-ranked videos and links | Every day |
| Everything else shown to students | Every week |
| Everything else | Every month |

- **YouTube videos** are checked through the API: deleted, private, or with embedding turned off means hidden.
- **Other links** are checked politely: a few checks per second per site, following redirects, and spotting "soft" error pages (a page that loads but says "not found").
- **Dead docs** fall back to their saved copy on the Internet Archive's Wayback Machine, or are swapped for the best replacement.
- **Two failures in a row** hide a link; a recovery shows it again.
- Students can press **"this link is broken"** to have it checked right away.

About 500,000 non-YouTube links checked weekly is under one check per second, which a small server handles easily.

## Uploads

1. The uploader accepts the rules and agrees that the AI may analyse the video.
2. The video goes straight from their browser to the video service; it never passes through our servers.
3. **The AI checks it before anyone sees it:** inappropriate content, violence, hate, spam, links to malware, and personal details such as phone numbers, addresses or school names.
4. **Clear cases** are published or rejected automatically. **Borderline cases** go to a content reviewer.
5. **Uploads from under-18s are always reviewed by a person** before going public, and can't show contact details.
6. Once published, the full pipeline from Block 1 links it to code and concepts.

## Copyright

- A **copyright takedown form** (DMCA): the claimant identifies the video and swears they own it.
- The video is hidden quickly, the uploader is told, and they can send a **counter-notice**.
- People who upload stolen videos repeatedly lose upload access, then their account.
- Register a **DMCA agent** with the US Copyright Office (a small fee), which the law needs for this protection.
- Uploads that look like re-uploads of someone else's YouTube video are flagged for review.

## Comments and reviews

- The AI screens written reviews and comments before they're shown.
- Everything public can be reported, through the same report system as ForgeCenter (`registerReportTarget`). Moderators hide content and suspend accounts from the owner panel.
- Content from suspended accounts is hidden everywhere.

## The Academy's own lessons and docs

The AI writes most first drafts, so nothing is published without being checked:

1. **Draft** by the AI, in beginner, hobby and pro versions.
2. **Automatic checks:** every code example is run in the sandbox (Block 3) and must produce its expected output; links are checked; reading level is measured.
3. **Review** by a content reviewer, who checks accuracy and clarity.
4. **Publish**, with a "last checked" date and the language version it covers.
5. **"Report an error"** on every page sends fixes to the review queue.

Every change is saved as a new version, so mistakes can be undone.

### Staying up to date

- When a language releases a new version, **every code example is run against it automatically.** Lessons with broken or outdated examples are flagged for review.
- Videos using old versions get an "older version" badge and rank lower.

### Translations

- The AI translates; people check the most-viewed pages first.
- **Code is never translated**, only the words around it.
- A shared glossary keeps terms the same everywhere.
- Each translated page shows whether a person has checked it.

## Data (adds to Block 1's tables)

```sql
CREATE TABLE links (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,                  -- video|doc|repo|site
  url text NOT NULL,
  canonical_url text UNIQUE NOT NULL,
  video_id bigint REFERENCES videos,   -- when kind = 'video'
  title text,
  source text NOT NULL,                -- youtube|upload|crawler|github|curated|suggested
  license text,
  status text NOT NULL DEFAULT 'candidate',   -- candidate|live|hidden|dead|removed
  failures smallint NOT NULL DEFAULT 0,
  last_checked_at timestamptz,
  next_check_at timestamptz,
  archive_url text,
  discovered_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON links (next_check_at);

CREATE TABLE link_topics (
  link_id bigint NOT NULL REFERENCES links,
  concept_id bigint NOT NULL REFERENCES concepts,
  level text NOT NULL,                 -- beginner|hobby|pro
  tagged_by text NOT NULL,             -- ai|person
  PRIMARY KEY (link_id, concept_id, level)
);

CREATE TABLE ratings (
  link_id bigint NOT NULL REFERENCES links,
  user_id bigint NOT NULL,
  level text NOT NULL,
  stars smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  tags text[] NOT NULL DEFAULT '{}',
  review text,
  review_state text NOT NULL DEFAULT 'none',  -- none|pending|shown|hidden
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (link_id, user_id)       -- one rating per account
);

CREATE TABLE link_scores (            -- recomputed in the background
  link_id bigint NOT NULL REFERENCES links,
  concept_id bigint NOT NULL REFERENCES concepts,
  level text NOT NULL,
  score real NOT NULL,
  rating_count int NOT NULL,
  completion_rate real,
  quiz_lift real,
  computed_at timestamptz NOT NULL,
  PRIMARY KEY (link_id, concept_id, level)
);
CREATE INDEX ON link_scores (concept_id, level, score DESC);

CREATE TABLE uploads (
  video_id bigint PRIMARY KEY REFERENCES videos,
  uploader_id bigint NOT NULL,
  service_asset_id text NOT NULL,
  analysis_consent_at timestamptz NOT NULL,
  moderation_state text NOT NULL,      -- checking|published|review|rejected|taken_down
  moderation_notes jsonb
);

CREATE TABLE copyright_notices (
  id bigserial PRIMARY KEY,
  video_id bigint NOT NULL REFERENCES videos,
  claimant text NOT NULL,
  claim jsonb NOT NULL,
  state text NOT NULL,                 -- received|taken_down|countered|restored|rejected
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE content_items (           -- the Academy's own lessons and docs
  id bigserial PRIMARY KEY,
  kind text NOT NULL,                  -- lesson|doc|quiz|project
  slug text UNIQUE NOT NULL,
  concept_id bigint REFERENCES concepts,
  language_version text
);
CREATE TABLE content_versions (
  item_id bigint NOT NULL REFERENCES content_items,
  version int NOT NULL,
  locale text NOT NULL,                -- 'en', 'ar', ...
  level text NOT NULL,
  body text NOT NULL,
  author text NOT NULL,                -- ai|person
  checks jsonb,                        -- example runs, link checks, reading level
  review_state text NOT NULL,          -- draft|checked|reviewed|published|retired
  reviewed_by bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, version, locale, level)
);
```

## Risks for Block 4

| Risk | What we do |
|---|---|
| Running out of YouTube API units | Channel lists and free feeds instead of search, 30-day spread for checks, apply for a higher limit |
| Breaking YouTube's policies | Official player only, refresh data every 30 days, never download or scrape |
| Fake or spam ratings | One rating per account, only after watching, signed-in only, unusual patterns flagged |
| Wrong AI tags or wrong AI-written lessons | Examples run automatically, a person reviews before publishing, "report an error" everywhere |
| Harmful uploads reaching kids | AI checks before anything is public, people review under-18 uploads and borderline cases |
| Copyright claims | A clear takedown process, a registered DMCA agent, repeat-offender rules |
| Old content going stale | Re-run every example on new language versions, "older version" badges, scheduled link checks |
