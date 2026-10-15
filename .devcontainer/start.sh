#!/bin/sh
# Starts ForgeCenter in a GitHub Codespace on the codespace's own web address, so links,
# sign-in redirects and the same-origin check use it instead of localhost.
if [ -n "$CODESPACE_NAME" ] && [ -n "$GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN" ]; then
  export BASE_URL="https://$CODESPACE_NAME-3000.$GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN"
  echo "ForgeCenter will be at $BASE_URL"
fi
exec npm run dev
