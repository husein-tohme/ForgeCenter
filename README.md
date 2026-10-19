# Forgehub

Code repos, live websites and a store for digital things, in one place.

- **Repos** at `/<username>/<repo>`: upload any files or whole folders, browse them, edit text files in the browser, and keep a commit history. Stars, explore and search.
- **Live sites**: a public repo with an `index.html` runs at `/p/<username>/<repo>/`, sandboxed so its scripts can't touch Forgehub accounts.
- **Store**: sell a repo's files as a download, take donations. Stripe Checkout direct charges on each seller's own connected account (Stripe Connect Express), with a fee (`FEE_PERCENT`, default 5). Buyers get a library with downloads. Digital goods only.
- **Forge AI**: Forgehub's own helper, answering from a hand-written knowledge base for free. With `ANTHROPIC_API_KEY` set, questions it can't answer go to Claude.
- **Accounts**: sign in with GitHub, Discord or Microsoft. Birthday asked once (13+, only the group is kept). Usernames, profiles, data export, account deletion, reports and moderation.
- Installable as an app (PWA), light and dark themes, sitemap, robots.txt, per-page titles, descriptions, canonical links and share images.

## Run it

Node 22.13+.

```sh
npm install
DEV_LOGIN=1 npm run dev   # local only: adds a "Dev sign-in" button
npm test                  # API tests
npm run check             # syntax-checks every JS file
```

## Settings (environment variables)

| Name | What for |
|---|---|
| `BASE_URL` | The site's public address, like `https://forgehub.onrender.com` |
| `DATABASE_PATH` | SQLite file (default `data/forgehub.db`); keep it on a persistent disk |
| `ADMIN_EMAILS` | Comma-separated owner emails (verified by the sign-in provider) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub sign-in; callback `BASE_URL/api/auth/github/callback` |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Discord sign-in; callback `BASE_URL/api/auth/discord/callback` |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | Microsoft sign-in; callback `BASE_URL/api/auth/microsoft/callback` |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Payments. Without them the store says "Payments open soon". Webhook: `BASE_URL/api/stripe/webhook`, listening to Connect events (`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `account.updated`) |
| `FEE_PERCENT` | Forgehub's fee per sale (default 5) |
| `ANTHROPIC_API_KEY` | Optional: Claude for Forge AI questions the knowledge base can't answer |
| `NODE_ENV=production` | In production |
