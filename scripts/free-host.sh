#!/usr/bin/env bash
# Puts ForgeCenter online for $0 on a free Ubuntu server (Oracle Cloud Always Free or
# Google Cloud e2-micro) at a free DuckDNS address with HTTPS. See docs/FREE-HOSTING.md.
#
#   curl -fsSL https://raw.githubusercontent.com/husein-tohme/ForgeCenter/main/scripts/free-host.sh -o free-host.sh
#   sudo bash free-host.sh
#
# Run it again any time to update the site to the latest code. Your data is kept.
# Switch to your own domain later with: sudo DOMAIN=forgecenter.eu.org bash free-host.sh
set -euo pipefail

REPO=https://github.com/husein-tohme/ForgeCenter.git
DIR=/opt/forgecenter

if [ "$(id -u)" -ne 0 ]; then echo "Run it with sudo: sudo bash free-host.sh"; exit 1; fi

ask() { # ask VAR "question" : keeps an existing value from the environment or the saved settings
  local var=$1 question=$2
  if [ -z "${!var:-}" ]; then read -r -p "$question " "$var" </dev/tty; fi
  if [ -z "${!var:-}" ]; then echo "That's needed. Run the script again when you have it."; exit 1; fi
}

# Answers from an earlier run, so updating doesn't ask again.
[ -f /etc/forgecenter.conf ] && . /etc/forgecenter.conf
# DOMAIN=forgecenter.eu.org uses a domain you own (its DNS A record pointing at this
# server) instead of a DuckDNS address.
DOMAIN=${DOMAIN:-${SAVED_DOMAIN:-}}
if [ -z "$DOMAIN" ] || [[ "$DOMAIN" == *.duckdns.org ]]; then
  ask DUCKDNS_NAME "Your DuckDNS name (the part before .duckdns.org):"
  DUCKDNS_NAME=${DUCKDNS_NAME%.duckdns.org}
  ask DUCKDNS_TOKEN "Your DuckDNS token (shown at the top of duckdns.org after you sign in):"
  DOMAIN="$DUCKDNS_NAME.duckdns.org"
fi
ask OWNER_EMAIL "Your email (the one you'll sign in with, to get the owner panel):"
umask 077
printf 'SAVED_DOMAIN=%q\nDUCKDNS_NAME=%q\nDUCKDNS_TOKEN=%q\nOWNER_EMAIL=%q\n' "$DOMAIN" "${DUCKDNS_NAME:-}" "${DUCKDNS_TOKEN:-}" "$OWNER_EMAIL" > /etc/forgecenter.conf
umask 022

if [[ "$DOMAIN" == *.duckdns.org ]]; then
  echo "==> Pointing $DOMAIN at this server"
  result=$(curl -fsS "https://www.duckdns.org/update?domains=$DUCKDNS_NAME&token=$DUCKDNS_TOKEN&ip=")
  if [ "$result" != "OK" ]; then echo "DuckDNS said no. Check the name and token at duckdns.org and try again."; exit 1; fi
  # Keep it pointed here if the server's address ever changes.
  echo "*/5 * * * * root curl -fsS \"https://www.duckdns.org/update?domains=$DUCKDNS_NAME&token=$DUCKDNS_TOKEN&ip=\" >/dev/null 2>&1" > /etc/cron.d/duckdns
  chmod 600 /etc/cron.d/duckdns
else
  rm -f /etc/cron.d/duckdns
  echo "==> Using $DOMAIN. Its DNS A record must point at this server's public IP."
fi

echo "==> Installing Docker (first run only)"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y ca-certificates curl git
  curl -fsSL https://get.docker.com | sh
fi
command -v git >/dev/null || apt-get install -y git

echo "==> Opening the web ports on this server's firewall"
# Oracle's Ubuntu images block everything but SSH in iptables by default.
if command -v iptables >/dev/null; then
  for port in 80 443; do
    iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || iptables -I INPUT 5 -p tcp --dport "$port" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null; then netfilter-persistent save >/dev/null 2>&1 || true; fi
fi

echo "==> Getting the latest ForgeCenter"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone --depth 1 "$REPO" "$DIR"; fi
cd "$DIR"

if [ ! -f .env ]; then
  echo "==> Writing settings (.env)"
  umask 077
  cat > .env <<EOF
NODE_ENV=production
PORT=3000
BASE_URL=https://$DOMAIN
ADMIN_EMAILS=$OWNER_EMAIL
SECRET_KEY=$(head -c 32 /dev/urandom | base64)
# Add keys here to turn on more features, then run: sudo bash free-host.sh
# (the owner page /sign-in-setup on your site shows exactly which ones).
EOF
  umask 022
fi

# Keep the site's address in step with the domain on later runs.
sed -i "s|^BASE_URL=.*|BASE_URL=https://$DOMAIN|" .env

echo "==> Starting the site (the first build takes a few minutes)"
SITE_DOMAIN="$DOMAIN" docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --build

echo "==> Waiting for it to answer"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://127.0.0.1:3000/"; then break; fi
  sleep 3
done

echo
echo "ForgeCenter is running at https://$DOMAIN"
echo "If the page doesn't open, open ports 80 and 443 in your cloud's network settings (docs/FREE-HOSTING.md, step 4)."
setup=$(docker compose logs web 2>/dev/null | grep -o 'Owner setup:.*' | tail -1 || true)
[ -n "$setup" ] && echo "$setup"
echo "To update later: sudo bash free-host.sh"
