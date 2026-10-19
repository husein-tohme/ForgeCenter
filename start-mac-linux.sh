#!/bin/sh
# Runs Forgehub on this computer for testing: http://localhost:3000
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --omit=dev
DEV_LOGIN=1 PORT=3000 node --disable-warning=ExperimentalWarning src/server.js
