#!/usr/bin/env bash
# Prints one in-game test's result as a single line, "<LABEL> {json}", adding links to its
# screenshots when this run uploads them to the test prerelease.
# Usage: print-result.sh LABEL result.json screenshot-prefix out.json
label=$1 file=$2 prefix=$3 out=$4
if [ ! -f "$file" ]; then
  echo "$label missing: the test did not get far enough to write it"
  exit 0
fi
if [ "$GITHUB_REF" != "refs/heads/entity-compactor-26.2" ]; then
  base="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/releases/download/ec26-test-results/run$GITHUB_RUN_NUMBER-$prefix"
  jq -c --arg base "$base" '.screenshotUrls = (.screenshots | map_values($base + (split("/") | last)))' "$file" > "$out"
else
  jq -c . "$file" > "$out"
fi
echo "$label $(cat "$out")"
