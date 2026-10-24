# 4. Technical design

- **Block 1: ingestion**, linking video moments to exact code lines. Done, below.
- **Block 2: the learning screen.** Done, in [its own document](04-block2-learning-screen.md).
- **Block 3: sandboxes** for bots, the playground, hacking labs and OS lessons. Done, in [its own document](04-block3-sandboxes.md).
- **Block 4: content**, finding, rating and checking links, uploads and moderation. Done, in [its own document](04-block4-content.md).

## Two facts that shape the design

1. **Big codebases aren't the hard part.** 500k lines is about 20 MB of source and 60–150k code units; one Postgres instance handles it. The hard part is the video side.
2. **Most internet videos will never match lines in our code.** So there are two levels of links:
   - **Line-level links** for videos whose code we can find: uploads, partner creators, and build-along videos that link a GitHub repo.
   - **Concept-level links** for every other video.

## Stack

| Concern | Choice |
|---|---|
| Main database | PostgreSQL 16 with `pgvector` and `btree_gist`. Range types make "what code is on screen at 1:35" and "which videos explain line 42" single index lookups. |
| Graph | Postgres edge tables first; Neo4j or Memgraph later, only if needed |
| Long jobs | Temporal (Python) |
| Events | Redpanda (Kafka API), for one event feeding several consumers |
| Parsing code | tree-sitter (grammars for nearly all 44 languages; a simple fallback parser for the rest) |
| Cross-references | SCIP indexers where they exist, stack-graphs or heuristics elsewhere; every link stores which method made it and how confident it is |
| Code search | Zoekt |
| Speech to text (uploads only) | faster-whisper with WhisperX and pyannote |
| Reading code on screen (uploads only) | PaddleOCR first, a vision model for hard frames, checked with tree-sitter |
| Compute | Kubernetes: a CPU pool, and GPU nodes that scale to zero |

## Video rights

| Video | What we may do |
|---|---|
| YouTube (not joined) | Metadata, the official embedded player, chapters and description, student "helped / skip" marks. Never download, record or scrape. |
| Creator joined and agreed | Full AI analysis |
| Uploaded to the site | Full AI analysis (uploaders agree when posting); hosted by a video service or linked from YouTube |

## Code pipeline

1. Clone and pin the commit.
2. Detect languages; mark vendored, minified and generated files so they're never linked to videos.
3. Store file contents once, by hash.
4. Parse into units: modules, classes, functions, plus routes, SQL queries, React components, Assembly procedures, Discord bot commands and webhook handlers.
5. Split units over about 1,500 tokens at statement blocks, keeping a link to the parent.
6. Resolve references to stable symbol keys.
7. Add edges: calls, imports, extends, renders, routes to, reads/writes a table, jumps to.
8. Embed each unit and index it for search.

**References never break:** edges point at stable symbols, not lines, and each unit has an exact hash and a "shape" hash that ignores renames and formatting. On every new commit, video links are moved: same hash → copy; changed → shift by the diff; moved → find by shape; gone → marked stale and never shown.

## Video pipeline (uploads and joined creators)

1. Decode audio and frames (1 per second, plus scene changes); drop duplicate frames.
2. Find the editor and terminal on screen; only those are read.
3. Transcribe with word timings, prompting with the repo's symbol names.
4. Read the code, the file name from the editor tab, and detect typing, pasting, scrolling and running.
5. Split into segments (intro, live coding, debugging, demo, recap) and title them.
6. Find a linked GitHub repo in the description.

## Matching a video to code lines

1. Find candidate code units by fingerprinting the code read from the screen.
2. Line up the screen lines with each candidate to get an exact line range.
3. Score it using the alignment, the file name, symbol names spoken, typing versus showing, and similarity.
4. **0.85 or more:** accepted. **0.50–0.85:** a person reviews it. **Below 0.50:** dropped, keeping only the concept link.

## Building the curriculum

- Concepts based on the ACM/IEEE CS2023 curriculum, plus language-specific ones.
- The AI tags each segment as teaching, using or assuming a concept; new concepts need a person's approval.
- Videos on one concept are grouped by style (beginner walkthrough, deep dive).
- Prerequisites come from the curriculum and from data.
- Each step's main video is chosen by alignment, audio quality, freshness and completion rate, with 2–3 alternatives.

## Data schema (PostgreSQL)

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Code
CREATE TABLE languages (
  id smallserial PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  track text NOT NULL,
  grammar text NOT NULL,
  resolver text NOT NULL
);
CREATE TABLE repositories (
  id bigserial PRIMARY KEY,
  source_url text UNIQUE NOT NULL,
  role text NOT NULL,                 -- spine|companion|example
  license_spdx text
);
CREATE TABLE snapshots (
  id bigserial PRIMARY KEY,
  repo_id bigint NOT NULL REFERENCES repositories,
  commit_sha char(40) NOT NULL,
  parent_snapshot_id bigint REFERENCES snapshots,
  indexer_versions jsonb NOT NULL,
  status text NOT NULL,
  UNIQUE (repo_id, commit_sha)
);
CREATE TABLE blobs (sha256 bytea PRIMARY KEY, byte_size int NOT NULL, storage_key text NOT NULL);
CREATE TABLE files (
  id bigserial PRIMARY KEY,
  snapshot_id bigint NOT NULL REFERENCES snapshots,
  path text NOT NULL,
  language_id smallint REFERENCES languages,
  blob_sha256 bytea NOT NULL REFERENCES blobs,
  line_count int NOT NULL,
  is_generated boolean NOT NULL DEFAULT false,
  UNIQUE (snapshot_id, path)
);
CREATE TABLE symbols (
  id bigserial PRIMARY KEY,
  repo_id bigint NOT NULL REFERENCES repositories,
  symbol_key text NOT NULL,
  kind text NOT NULL,
  display_name text NOT NULL,
  UNIQUE (repo_id, symbol_key)
);
CREATE TABLE code_units (
  id bigserial PRIMARY KEY,
  snapshot_id bigint NOT NULL REFERENCES snapshots,
  file_id bigint NOT NULL REFERENCES files,
  parent_id bigint REFERENCES code_units,
  symbol_id bigint REFERENCES symbols,
  kind text NOT NULL,
  lines int4range NOT NULL,
  bytes int8range NOT NULL,
  content_hash bytea NOT NULL,
  shape_hash bytea NOT NULL,
  signature text,
  doc text,
  token_count int NOT NULL
);
CREATE INDEX ON code_units USING gist (file_id, lines);
CREATE INDEX ON code_units (snapshot_id, symbol_id);
CREATE INDEX ON code_units (shape_hash);
CREATE TABLE code_edges (
  src_unit_id bigint NOT NULL REFERENCES code_units,
  dst_symbol_id bigint NOT NULL REFERENCES symbols,
  kind text NOT NULL,
  resolver text NOT NULL,
  confidence real NOT NULL,
  PRIMARY KEY (src_unit_id, dst_symbol_id, kind)
);
CREATE TABLE routes (
  unit_id bigint PRIMARY KEY REFERENCES code_units,
  framework text NOT NULL, http_method text, path_pattern text NOT NULL
);
CREATE TABLE unit_embeddings (
  unit_id bigint NOT NULL REFERENCES code_units,
  model text NOT NULL,
  embedding vector(1024) NOT NULL,
  PRIMARY KEY (unit_id, model)
);
CREATE TABLE unit_fingerprints (
  fingerprint bigint NOT NULL,
  unit_id bigint NOT NULL REFERENCES code_units,
  line_no int NOT NULL
);
CREATE INDEX ON unit_fingerprints (fingerprint);

-- Video
CREATE TABLE channels (
  id bigserial PRIMARY KEY,
  platform text NOT NULL, external_id text NOT NULL, display_name text NOT NULL,
  partner_status text NOT NULL DEFAULT 'none',   -- none|joined|owned
  UNIQUE (platform, external_id)
);
CREATE TABLE videos (
  id bigserial PRIMARY KEY,
  channel_id bigint REFERENCES channels,
  platform text NOT NULL,              -- youtube|upload
  external_id text NOT NULL,
  title text NOT NULL,
  duration_ms int NOT NULL,
  published_at timestamptz,
  spoken_lang text,
  form text NOT NULL,                  -- short|long
  rights text NOT NULL,                -- embed_only|analyze|owned
  media_key text,
  companion_repo_id bigint REFERENCES repositories,
  tech_versions jsonb,
  pipeline_state text NOT NULL,
  UNIQUE (platform, external_id)
);
CREATE TABLE transcript_words (
  video_id bigint NOT NULL, span int8range NOT NULL, word text NOT NULL,
  speaker smallint, confidence real
) PARTITION BY HASH (video_id);
CREATE TABLE frames (
  id bigserial PRIMARY KEY, video_id bigint NOT NULL REFERENCES videos,
  ts_ms int NOT NULL, phash bigint NOT NULL, storage_key text NOT NULL
);
CREATE TABLE frame_regions (
  id bigserial PRIMARY KEY, frame_id bigint NOT NULL REFERENCES frames,
  region_kind text NOT NULL, bbox box NOT NULL,
  ocr_text text, ocr_engine text, ocr_confidence real, parses boolean,
  path_hint text, language_hint smallint REFERENCES languages
);
CREATE TABLE code_events (
  video_id bigint NOT NULL REFERENCES videos, at_ms int NOT NULL,
  kind text NOT NULL, path_hint text, delta text
);
CREATE TABLE video_segments (
  id bigserial PRIMARY KEY,
  video_id bigint NOT NULL REFERENCES videos,
  span int8range NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  summary text,
  boundary_evidence jsonb,
  quality real,
  embedding vector(1024),
  EXCLUDE USING gist (video_id WITH =, span WITH &&)
);

-- Students' "helped" and "skip" marks (the legal way to find the best parts of YouTube videos)
CREATE TABLE moment_marks (
  video_id bigint NOT NULL REFERENCES videos,
  user_id bigint NOT NULL,
  span int8range NOT NULL,
  kind text NOT NULL,                  -- helped|skip
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON moment_marks USING gist (video_id, span);

-- Links between video moments and code
CREATE TABLE anchors (
  id bigserial PRIMARY KEY,
  video_id bigint NOT NULL REFERENCES videos,
  segment_id bigint NOT NULL REFERENCES video_segments,
  span int8range NOT NULL,
  repo_id bigint NOT NULL REFERENCES repositories,
  symbol_id bigint REFERENCES symbols,
  relation text NOT NULL,              -- typed_live|shown|explained|mentioned|contrasted
  confidence real NOT NULL,
  evidence jsonb NOT NULL,
  origin text NOT NULL,                -- auto|human
  review_state text NOT NULL DEFAULT 'proposed',
  CHECK (NOT isempty(span))
);
CREATE INDEX ON anchors USING gist (video_id, span);
CREATE TABLE anchor_locations (
  anchor_id bigint NOT NULL REFERENCES anchors,
  snapshot_id bigint NOT NULL REFERENCES snapshots,
  file_id bigint NOT NULL REFERENCES files,
  unit_id bigint REFERENCES code_units,
  lines int4range NOT NULL,
  remap text NOT NULL,                 -- original|same_hash|diff_shift|shape_match|stale
  PRIMARY KEY (anchor_id, snapshot_id)
);
CREATE INDEX ON anchor_locations USING gist (file_id, lines);
CREATE TABLE anchor_reviews (
  anchor_id bigint NOT NULL REFERENCES anchors,
  reviewer_id bigint NOT NULL,
  verdict text NOT NULL,
  adjusted jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Curriculum
CREATE TABLE concepts (
  id bigserial PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL,
  scope text NOT NULL, language_id smallint REFERENCES languages,
  cs2023_ref text, status text NOT NULL DEFAULT 'approved'
);
CREATE TABLE concept_prereqs (
  concept_id bigint NOT NULL REFERENCES concepts,
  requires_id bigint NOT NULL REFERENCES concepts,
  weight real NOT NULL, source text NOT NULL,
  PRIMARY KEY (concept_id, requires_id),
  CHECK (concept_id <> requires_id)
);
CREATE TABLE concept_idioms (          -- feeds the Context Switcher
  concept_id bigint NOT NULL REFERENCES concepts,
  language_id smallint NOT NULL REFERENCES languages,
  example_unit_id bigint REFERENCES code_units,
  note text,
  PRIMARY KEY (concept_id, language_id)
);
CREATE TABLE segment_concepts (
  segment_id bigint NOT NULL REFERENCES video_segments,
  concept_id bigint NOT NULL REFERENCES concepts,
  role text NOT NULL, weight real NOT NULL,
  PRIMARY KEY (segment_id, concept_id, role)
);
CREATE TABLE unit_concepts (
  unit_id bigint NOT NULL REFERENCES code_units,
  concept_id bigint NOT NULL REFERENCES concepts,
  weight real NOT NULL,
  PRIMARY KEY (unit_id, concept_id)
);
CREATE TABLE tracks (
  id bigserial PRIMARY KEY, slug text UNIQUE NOT NULL, title text NOT NULL,
  level text NOT NULL, spine_repo_id bigint REFERENCES repositories
);
CREATE TABLE track_steps (
  track_id bigint NOT NULL REFERENCES tracks,
  position int NOT NULL,
  concept_id bigint NOT NULL REFERENCES concepts,
  primary_segment_id bigint REFERENCES video_segments,
  alt_segment_ids bigint[] NOT NULL DEFAULT '{}',
  anchor_unit_id bigint REFERENCES code_units,
  PRIMARY KEY (track_id, position)
);
```

## Risks for Block 1

| Risk | What we do |
|---|---|
| Video rights and YouTube's rules | The `rights` column gates every step; full analysis only for uploads and joined creators |
| Reading code off screens is error-prone | tree-sitter checks, a vision model for hard frames, matching that tolerates errors |
| Weak cross-references for Assembly, R, Haskell, F# | Every edge stores its method and confidence; weak ones are never auto-accepted |
| C/C++ macros | Needs a sandboxed build to get compile commands |
| Videos teaching old versions | Detect versions, lower their score, show an "older version" badge |
| Links breaking across commits | Symbol-based links, remapping, and a stale state that's never shown |
| GPU cost | Drop duplicate frames, read only editors and terminals, use the vision model only when unsure, scale GPUs to zero |
