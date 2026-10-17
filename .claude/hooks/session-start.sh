#!/bin/bash
# Installs ForgeCenter's packages in Claude Code cloud sessions, so `npm test`,
# `npm run check` and the Discord bot template's tests work straight away.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
# npm install (not ci) so the container's cached node_modules is reused between sessions.
npm install --no-audit --no-fund
npm install --no-audit --no-fund --prefix templates/discord-bot
