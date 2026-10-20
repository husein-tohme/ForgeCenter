---
description: Fan a task out to many specialist agents in parallel, then merge their results
argument-hint: <task> [--agents N]
---

Run this task with a swarm of agents: $ARGUMENTS

1. Use the `planner` agent to split the task into independent pieces (default up to 8; honour `--agents N`, capped at 20 so cost stays sane).
2. Launch one agent per piece **in a single message** so they run in parallel. Pick the best specialist for each piece: `explorer`, `implementer`, `test-writer`, `frontend-builder`, `docs-writer`, `oauth-specialist`, `perf-checker`. Pieces that edit the same file run one after another, not in parallel.
3. When they finish, launch the checkers in parallel on the combined diff: `reviewer`, `security-auditor`, plus `payments-guard`, `privacy-guard` or `accessibility-checker` when the diff touches their area.
4. Fix what the checkers confirm, run `npm run check` and `npm test`, and summarise: what each agent did, what's verified, what's still open.
