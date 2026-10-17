---
name: deploy-forgecenter
description: Put ForgeCenter online - pick a host (Railway, Render, Fly.io, a VPS with Docker, or GitHub Codespaces for trying it), set the environment variables, keep the SQLite database on a persistent disk, run the website and the bot runner, and connect Stripe webhooks, sign-in redirect URLs and the domain. Use when the person asks how to launch, host, deploy or get a link for ForgeCenter.
---

# Putting ForgeCenter online

ForgeCenter is one Node 22.13+ app plus a second process for customer Discord bots, sharing one SQLite file. Whatever the host, three things matter: **a persistent disk for `DATABASE_PATH`**, **both processes running** (`npm start` and `npm run bots`), and **`NODE_ENV=production` with `BASE_URL` set to the real https address**.

## Just to try it

GitHub Codespaces: on the repository, **Code > Codespaces > Create codespace**. `.devcontainer/` installs everything and opens the site at `https://<name>-3000.app.github.dev`. Private by default; set port 3000 to Public in the Ports tab to share. It stops when idle and isn't a place for the real shop.

## Hosts for the real site

- **Railway** or **Render**: connect the GitHub repository, add a volume (Railway) or a persistent disk (Render, paid plan) mounted at e.g. `/data`, set `DATABASE_PATH=/data/forgecenter.db` and `BOT_DATA_DIR=/data/bots`, and add a second service or worker running `npm run bots` on the same disk (Render: a background worker cannot share a disk, so use the Docker setup or run both in one service with the Procfile).
- **Fly.io**: a volume mounted at `/data`, both processes from the `Procfile`.
- **A VPS**: `docker compose up -d --build` runs the website and the bot runner on the shared `forgecenter-data` volume. Put Caddy or another HTTPS proxy in front of port 3000.

## Settings

Copy every key from `.env.example` into the host's secret settings, never into the repository. Required for launch: `BASE_URL`, `GOOGLE_CLIENT_ID` (or another sign-in provider), `ADMIN_EMAILS`, `STRIPE_SECRET_KEY` (a restricted key, see README), `STRIPE_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `SECRET_KEY` (32+ random characters; never change it after launch), `CONTACT_EMAIL`. The `/forgecenter` command in this plugin checks which are missing.

## After the first deploy

1. **Stripe**: add the webhook endpoint `https://YOUR-DOMAIN/api/stripe/webhook` with every event listed in README > Stripe, and put its signing secret in `STRIPE_WEBHOOK_SECRET`. Turn on the Customer Portal, with cancellation at the end of the billing period. Turn on Stripe Identity if you want ID-scan age checks.
2. **Sign-in**: add `https://YOUR-DOMAIN` to the Google client's Authorized JavaScript origins, and `https://YOUR-DOMAIN/api/auth/<provider>/callback` to each GitHub, Microsoft and Discord app.
3. **Email**: verify the domain in Resend and set `RESEND_API_KEY` and `EMAIL_FROM`.
4. **Check**: sign in with an `ADMIN_EMAILS` account, open `/admin`, buy something with a Stripe test card, and confirm the order turns paid through the webhook.
5. **Domain**: point the domain at the host, then update `BASE_URL`, the Stripe webhook and the sign-in URLs to it.
