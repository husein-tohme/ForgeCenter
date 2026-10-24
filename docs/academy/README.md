# The CodeHub plan

The plan for CodeHub, ForgeCenter's learning site: video lessons synced to real code, an AI tutor, and tracks for 44 languages, from Scratch to building an operating system.

This folder is the plan. The plan is finished, and building has started (see the checklist below).

## The documents

| # | Document | Status |
|---|---|---|
| 1 | [Overview](01-overview.md): what it is and why it's better | Done |
| 2 | [Features](02-features.md): everything agreed, sorted into launch, soon and later | Done |
| 3 | [Tracks and languages](03-tracks.md): every course, in order | Done |
| 4 | [Technical design](04-technical.md): Blocks 1–4 ([Block 2: the learning screen](04-block2-learning-screen.md), [Block 3: sandboxes](04-block3-sandboxes.md), [Block 4: content](04-block4-content.md)) | Done |
| 5 | [Money, accounts and legal](05-money-and-legal.md), with [accounts, roles, inboxes and messages in detail](05b-accounts-and-roles.md) | Done |
| 6 | [Roadmap](06-roadmap.md): what gets built when, and the risks | Done |

## How "start" and "continue" work

When the owner says **continue**, do the first unchecked step below, update the documents, tick the step, commit and push, then say in a few lines what was done and what's next.

- [x] Write documents 1, 2, 3 and 5 from the decisions made in chat, and Block 1 in document 4
- [x] Block 2: the learning screen (video, code and map together; Context Switcher; starting quiz; docs pages)
- [x] Block 3: sandboxes (Discord bots, code playground, hacking labs, OS lessons)
- [x] Block 4: content (finding, rating and checking 2 million links; uploads; moderation)
- [x] Accounts and roles in detail (sign-in, roles, inboxes and message safety)
- [x] Document 6: the roadmap, with risks for each phase
- [x] Final check: read every document for gaps and contradictions, and ask the owner about anything still open
- [ ] Start building Phase 1 ([roadmap](06-roadmap.md)), once the owner has answered the open questions below, in this order:
  - [x] 1. Check whether ForgeCenter's bot runner isolates code from strangers well enough for student bots, and choose the launch approach (it doesn't; see [decision 4](decisions.md#4-student-discord-bots-at-launch-no-student-code-runs-on-forgecenters-server))
  - [x] 2. The `/learn` section: tables for tracks, lessons, code files, clips, video-to-code links, ratings and marks, and the owner API to add them (`src/learn.js`, tested in `test/learn.test.js`)
  - [ ] 2b. Owner panel pages for adding tracks, lessons, code files, clips and links
  - [ ] 3. The lesson page: YouTube clip with start and end times, the code viewer, and video-to-code sync
  - [ ] 4. The starting quiz and personal paths
  - [ ] 5. Ratings, "helped" and "skip" marks, ranking, and the quick clips feed
  - [ ] 6. Docs pages in beginner, hobby and pro versions
  - [ ] 7. The browser playground: Python, JavaScript, HTML/CSS, SQL
  - [ ] 8. The AI tutor panel (from ForgeCenter's mentor), with lesson context, "explain it simpler" and homework-safe mode
  - [ ] 9. Student Discord bots, as chosen in step 1: the in-browser Discord simulator, hosted template bots built from settings, and the "deploy it yourself" lesson
  - [ ] 10. Staff roles granted only by the owner, the audit log, and required two-step login for staff
  - [ ] 11. Verified students through a school email code
  - [ ] 12. Plans in Stripe test mode ($1 first month, monthly, 3, 6 and 12 months)
  - [ ] 13. Legal pages: terms, privacy, refunds
  - [ ] 14. The first lessons for Python, websites and Discord bots, from the owner's starting videos

Each build step follows the repo's rules in `CLAUDE.md`: tests for everything new, `npm test` and `npm run check` before every commit.

## Decisions made so far

See [decisions.md](decisions.md): the name CodeHub, built inside ForgeCenter at `/learn`, first videos suggested for the owner to approve, and how student bots work at launch.

## Needed from the owner before launch

- Approval of the suggested first videos

- A YouTube Data API key, an Anthropic API key, and the sign-in keys added on Render

## Final check notes

Fixed while checking:

- The launch playground covers only the languages that run in the browser; the others come with the server sandboxes
- Launch projects are bots and websites; Roblox and Minecraft projects follow
- Direct messages, parent view, school billing and under-13 accounts moved to "later", to match the roadmap and the safety rules
- The message summary in document 2 now matches the full table in document 5b, including parents
- Document 4 says when its bigger stack arrives (Phase 3)
- The income example notes that yearly plans lower the monthly number
- Added the Idea Engine (project and business ideas), which was agreed early in planning but missing
