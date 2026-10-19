#!/usr/bin/env bash
# Fails if the game log shows a mixin problem or an error naming Entity Compactor.
# Usage: check-game-log.sh <log file>...
set -u
mixin='Mixin apply failed|InvalidInjectionException|MixinTargetAlreadyLoadedException|Could not find any targets'
status=0
for log in "$@"; do
  if [ ! -f "$log" ]; then
    echo "EC_MIXIN_CHECK $log: missing"
    status=1
    continue
  fi
  mixin_hits=$(grep -nE "$mixin" "$log")
  # Errors from our mod or its test, but not our own result lines.
  our_errors=$(grep -niE 'entitycompactor|dev\.forgecenter' "$log" | grep -E 'ERROR|FATAL|Exception|Caused by' | grep -v 'EC_RESULT')
  m=$(printf '%s' "$mixin_hits" | grep -c . || true)
  e=$(printf '%s' "$our_errors" | grep -c . || true)
  echo "EC_MIXIN_CHECK $log: $(wc -l < "$log") lines, $m mixin problems, $e errors naming entitycompactor"
  [ -n "$mixin_hits" ] && printf '%s\n' "$mixin_hits" | head -40
  [ -n "$our_errors" ] && printf '%s\n' "$our_errors" | head -40
  if [ "$m" -gt 0 ] || [ "$e" -gt 0 ]; then status=1; fi
done
if [ $status -eq 0 ]; then echo "EC_MIXIN_CHECK result: clean"; else echo "EC_MIXIN_CHECK result: PROBLEMS FOUND"; fi
exit $status
