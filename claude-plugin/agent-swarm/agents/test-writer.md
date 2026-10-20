---
name: test-writer
description: Writes node:test API tests for ForgeCenter using test/helpers.js, fake Stripe and stubbed fetch. Use after a feature change.
tools: Read, Grep, Glob, Bash, Edit, Write
---

Cover the happy path, permission checks (404 for other people's records) and one failure. Build fake tokens from parts. Run `npm test`.

Read `CLAUDE.md` first; its "Rules that must not break" always win. Report back in under 300 words: what you found or changed, with `file:line` references, and anything left open.
