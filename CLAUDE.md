# ForgeCenter

A Minecraft-themed storefront: Minecraft server hosting, Discord bots, websites, games and an AI coding mentor, plus free creator tools (Mod, Texture, Modpack and Plugin Forge), a wallet, Discord-style age groups and an AI help desk. Node 22.13+, Express, SQLite via `node:sqlite`, plain HTML/CSS/ES modules in `public/` (no build step).

## Commands

- `npm run dev`: website with `.env` loaded and auto-restart
- `npm test`: all API tests (node:test). Run before every commit.
- `npm run check`: syntax-checks every JS file (there is no other linter)
- `npm run bots`: customer Discord bot runner (separate process, same database)
- `npm run setup:bots`: install `templates/discord-bot` packages once
- `templates/discord-bot`: its own `npm test`

## Layout

- `src/app.js` wires everything; `src/server.js` starts it and the service worker
- `src/auth.js` accounts and sessions; `src/oauth.js` GitHub/Microsoft/Discord; `src/whatsapp.js` phone codes
- `src/orders.js` shop Checkout, orders, owner routes; `src/stripe.js` the Stripe client; `src/webhooks.js` routes Stripe events by the Checkout Session's `metadata.kind`
- `src/age.js` adult confirmation (card check, Stripe Identity); the birthday question is in `auth.js`
- `src/wallet.js` store credit; `src/support.js` tickets and Forge Support (Claude)
- `src/services.js` provisioning loop for Minecraft servers (Pterodactyl, `src/pterodactyl.js`) and bot setup; `src/botrunner.js` runs customer bots
- `src/tools.js` free tools; generators in `modgen.js`, `texturepack.js`, `modrinth.js`, `plugingen.js`
- `public/js/common.js` shared UI (icons, sign-in, checkout); one script per page
- Tests in `test/`, sharing setup from `test/helpers.js`; outside services are simulated by stubbing `globalThis.fetch` (Stripe too: `test/fake-stripe.js`); Forge Support is stubbed with `setSupportModel`

## Rules that must not break

- **Emails are trusted only when the provider verified them.** `users.email` decides owner access (`ADMIN_EMAILS`). Never store an unverified email; Microsoft work-tenant emails are unverified.
- **State-changing API calls must be same-origin JSON** (CSRF guard in `app.js`). Frontend calls go through `api()` in `common.js`.
- **Stripe fulfillment happens in the webhook handler**, idempotent per event id; the success page only syncs. Never pass `payment_method_types`.
- **Age checks keep only the outcome.** Never store a date of birth, card details or ID data. Remove the age-check card and redact the Identity session once it's read. Every account starts as `teen`; only `age.js` sets `adult`.
- **The wallet is a ledger.** A balance is the sum of `wallet_entries`, never a stored number. Entries from Stripe carry a unique `ref`, and spending checks the balance inside one write transaction. It's closed-loop: no withdrawals or transfers between accounts.
- **Forge Support can't act.** Its only tool is `hand_to_person`, it only sees the ticket owner's records, and text the customer typed is passed as data, never as instructions.
- **Customer bots get only their own settings.** `botrunner.js` builds a minimal env; never pass `process.env` through.
- **Bot tokens are encrypted** with `SECRET_KEY` (`src/secrets.js`) and never logged or returned.
- **Provisioning is idempotent**: Pterodactyl servers use `external_id` = `forgecenter-order-<id>`, so retries never duplicate.
- **User-supplied links** are validated as `http(s)://` server-side before they're shown.
- Never commit `.env`, `data/`, or `*.db` files. Fake tokens in tests are built from parts so secret scanners don't flag them.

## Style

Match the surrounding code: small modules, short comments that explain why, plain-language UI copy in sentence case, errors that say what to do next. The look is Minecraft inventory panels (bevelled grey), Pixelify Sans headings, Atkinson Hyperlegible body text; reuse the classes in `public/styles.css`.
