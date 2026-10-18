#!/bin/sh
# Starts ForgeCenter on a host whose disk is wiped on restart (Render's free plan):
# restores the database from the Litestream backup, then runs the site while Litestream
# keeps backing it up every second. Without backup settings it just starts the site.
set -e
mkdir -p "$(dirname "$DATABASE_PATH")"

if [ -n "$LITESTREAM_ACCESS_KEY_ID" ] && [ -n "$LITESTREAM_SECRET_ACCESS_KEY" ]; then
  echo "Restoring the database from the backup (if there is one)..."
  litestream restore -config /app/litestream.yml -if-db-not-exists -if-replica-exists "$DATABASE_PATH"
  exec litestream replicate -config /app/litestream.yml -exec "node scripts/start-all.mjs"
fi

echo "No backup settings (LITESTREAM_*), so accounts and orders will be lost when the server restarts."
exec node scripts/start-all.mjs
