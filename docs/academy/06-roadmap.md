# 6. Roadmap

What gets built in what order, what "done" means for each phase, what the owner needs to provide, and what could go wrong.

## The big decision first: start inside ForgeCenter

**Recommended:** build the launch version as a new section of ForgeCenter (for example `/learn`), using ForgeCenter's own stack (Node, Express, SQLite, plain HTML/CSS/JS), and move to the bigger stack from [document 4](04-technical.md) only when each part needs it.

Why:

- ForgeCenter already has most of what launch needs: sign-in for every provider, the Forge mentor and daily AI limits, Stripe checkout, support tickets, reports and suspensions, Discord bot hosting, and Minecraft and Roblox tools.
- The bigger stack (Postgres, Python workers, Temporal, Kubernetes, micro-VMs) is built for millions of links and AI video analysis. Launch doesn't do that yet, and running it early would cost money and time for nothing.
- At launch, the video-to-code links for the first lessons are **made by people** (marking "this clip explains these lines"), not by the AI pipeline. SQLite handles that easily.
- It can become its own site with its own name later; the documents are written so nothing depends on staying inside ForgeCenter.

**Owner decision needed:** go with this, or start as a separate site from day one.

## Phase 1: Launch

**Goal:** a beginner can take the quiz, follow a path, and have a live website or Discord bot the same day.

What's in it:

- Tracks: **Python, websites (HTML, CSS, JavaScript) and Discord bots**, for beginners and hobby coders
- The starting quiz and personal paths
- Lessons with YouTube clips that start and stop at the right moment
- Video-to-code sync for launch lessons, using links made by people
- Ratings, "helped" and "skip" marks, best 2–3 videos per topic, the quick clips feed
- Written docs for every launch topic, in beginner, hobby and pro versions
- The AI tutor (from ForgeCenter's mentor), with "explain it simpler", homework-safe mode and daily limits
- The browser playground for Python, JavaScript, HTML/CSS and SQL
- Discord bot hosting for students (see the sandbox risk below)
- Sign-in with Google, Microsoft, Discord, WhatsApp and GitHub; the owner set with `ADMIN_EMAILS`
- Roles: owner, admin, moderator, support, reviewer, student, verified student
- Free plan and free verified-student plan live; paid plans built in Stripe test mode
- Notifications and support inboxes, reports, the owner panel, backups, error tracking, usage stats
- Legal pages: terms, privacy, refunds, rules

**Done when:**

- Five real beginners each get from the quiz to a live project without help
- Lesson pages are usable in under 3 seconds on a cheap phone on slow internet
- All tests pass, backups run daily, and restoring a backup has been tried once
- Legal pages are up and the owner has read them

**Owner provides:** the site name (or "ForgeCenter Learn" for now), a YouTube Data API key, the sign-in keys on Render, an Anthropic API key, and 20–30 good beginner videos to start the launch lessons.

**Risks:**

| Risk | What we do |
|---|---|
| ForgeCenter's bot runner may not isolate code from strangers well enough | Check it before launch. If it isn't enough, give students a hosted sandbox service, or limit launch bots to approved templates, until the Phase 4 sandboxes exist |
| Writing enough good lessons takes longer than the code | Launch with fewer, better lessons; the AI drafts and the owner reviews |
| AI costs grow with users | Daily limits, short answers, cached answers for common questions |

## Phase 2: Growing

**Goal:** more to learn, reasons to come back, and the first schools.

- Wave 2 languages: **Luau, Java, C#, SQL and Scratch**
- Server-side playground runs (gVisor sandboxes) for languages the browser can't run
- XP, levels, streaks, achievements, weekly challenges, certificates, portfolio pages, the project gallery
- The Discord server linked to the site, with roles for finished tracks
- **Teacher accounts and classes** (teachers approved by the owner), the class inbox
- **Arabic translation**, then Spanish, Hindi and French
- Voice: lessons and answers read aloud
- Learning map, picture-in-picture, auto notes and flashcards, cheat sheets
- Invite rewards

**Done when:** a teacher can run a whole class on it for a month, and Arabic-speaking students can learn without needing English.

**Owner provides:** approval of the first teachers, and a native speaker to check the most-viewed Arabic pages.

**Risks:** translations that sound wrong (people check the top pages first); teachers waiting on approval (the owner panel shows a clear queue).

## Phase 3: Videos at scale

**Goal:** the 2 million links, uploads, and AI that links videos to code automatically.

- Move to **Postgres**, with Python workers and a job queue, for the pipeline in [Block 1](04-technical.md) and [Block 4](04-block4-content.md)
- Finding, sorting, ranking and checking links at scale, within YouTube's limits
- **Uploads**, with AI checks before publishing and people reviewing under-18 uploads
- Creators who join, the creator dashboard, AI chapters, collections, video requests
- Copyright takedowns, with a registered DMCA agent
- AI-drafted docs with automatic example runs and review

**Done when:** a new coding video on a known channel appears, sorted and ranked, within a day; an upload is linked to the right code lines automatically most of the time; dead links disappear within a week.

**Owner provides:** a request to YouTube for a higher API limit, the DMCA agent registration, and a list of good coding channels to start from.

**Risks:** YouTube limits or policy problems (stay inside their rules and limits); harmful uploads (nothing goes public before checks); GPU costs for analysing uploads (process only what's needed, scale to zero).

## Phase 4: Sandboxes for everything

**Goal:** students can safely run anything: always-on bots, websites with servers, hacking labs and their own operating systems.

- **Firecracker micro-VMs** on dedicated servers, in a separate account and network ([Block 3](04-block3-sandboxes.md))
- Discord bots moved to micro-VMs; paid always-on bots
- Student websites on their own separate domain, including ones with a server
- **Hacking labs**, sealed off from the internet, with rules acceptance and age controls
- **OS lessons** in the browser emulator
- Minecraft lessons on short-lived ForgeCenter servers

**Done when:** an outside security review finds no way out of a sandbox, and abuse (mining, scanning, spam) is stopped automatically in testing.

**Owner provides:** dedicated servers that allow virtual machines (for example Hetzner), and a budget for an outside security review.

**Risks:** a sandbox escape (layers of protection, nothing valuable inside, quick updates); servers used to attack others (no network by default, kill switch).

## Phase 5: Every language and expert track

**Goal:** the full [tracks document](03-tracks.md).

- Language waves 3–6, ending with all 44 languages
- Project tracks and expert tracks: make an OS, a Minecraft server from scratch, your own language, a game engine, an emulator, a database, quantum computing
- The full Context Switcher and the "what the computer is doing" panel for every language
- The full language references

**Done when:** every field in the "every field of coding" checklist has a finished track.

**Risks:** this is the biggest content job of all; each wave ships when its tracks are reviewed, not on a fixed date.

## Phase 6: Schools, families and the "later" features

- School admins and school billing, exam mode with copy detection, parent accounts
- **Direct messages**, only once the message safety rules in [document 5b](05b-accounts-and-roles.md) are fully built and tested
- Under-13 accounts through schools and parents, after a lawyer checks the consent flow
- Live classes, mentors, code battles, pair coding, hackathons, the job board, career paths, sponsored tracks
- The VS Code extension, the phone app, offline mode

**Done when:** schools can sign up and pay on their own, and the message rules pass a safety review.

**Risks:** children's safety and privacy (the strictest phase; nothing ships without the safety review and legal check).

## Phase 7: Real payments

Happens whenever the owner moves to Europe or North America, which may be before some phases above.

- Open a Stripe account (or Tebex, after checking it accepts a coding-school subscription)
- Switch from test keys to live keys, turn on tax collection, test one real payment and refund
- Turn on paid plans, school billing and creator tips

**Done when:** a real payment, a renewal, a refund and a cancellation have all been tested with real money.

## Risks across the whole project

| Risk | What we do |
|---|---|
| Building too much before launching | Launch Phase 1 first; everything else waits for real students |
| One person running everything | Owner-only decisions stay small (roles, approvals); the rest is automated or done by staff roles |
| Weekly AI usage limits slowing the build | The plan lives in these documents, so every session picks up exactly where the last one stopped |
| Content quality | The AI drafts, examples are run automatically, people review, students report errors |
| Costs before income | Free tools first (browser playground, YouTube hosting, test-mode payments); spend only when a phase needs it |
| Laws for children, copyright and privacy | Strict rules from day one; a lawyer's check before under-13s and before real payments |
