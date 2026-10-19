# Forgehub

Code repos, live websites and a store for digital goods. Node 22.13+, Express, SQLite via `node:sqlite`, plain HTML/CSS/ES modules in `public/` (no build step).

## Commands
- `npm run dev` (with `DEV_LOGIN=1` for a local test sign-in), `npm test` before every commit, `npm run check` for syntax.

## Layout
- `src/app.js` wires routes, security headers, the CSRF guard and page rendering (`%TITLE%`, `%DESCRIPTION%`, `%URL%` placeholders in `public/*.html`)
- `src/db.js` the whole schema; `src/auth.js` accounts, sessions, birthday, usernames, export, delete; `src/oauth.js` GitHub/Discord/Microsoft sign-in
- `src/repos.js` repos, files, commits, stars, raw downloads (`/raw`), zips (`/zip`) and live sites (`/p`)
- `src/store.js` products, Stripe Connect, checkout, library, downloads and the Stripe webhook
- `src/forgeai.js` Forge AI's knowledge base and the optional Claude fallback
- `src/domains.js` live sites on subdomains (`SITES_DOMAIN`) and verified custom domains; `siteHosts` runs first in `app.js`
- `src/messages.js` the inbox, blocks and the scam filter
- `src/reports.js` reports, owner panel, suspensions
- `public/js/common.js` shared UI (header, sign-in, setup dialogs, cookie notice, theme, reports); one script per page
- Tests in `test/` share `test/helpers.js` (in-memory database, real HTTP)

## Rules that must not break
- **Emails are trusted only when the provider verified them**; `ADMIN_EMAILS` relies on it.
- **State-changing API calls are same-origin JSON.** The only raw-body route is the file upload PUT, which must carry this site's Origin.
- **Uploaded files never render on Forgehub's origin.** `/raw` is always an attachment with `application/octet-stream`; live sites under `/p` get `Content-Security-Policy: sandbox` without `allow-same-origin`. Text is shown escaped.
- **Custom domains are served only after TXT verification**, and site hosts never reach Forgehub's pages or API (read-only, GET/HEAD).
- **Paths go through `cleanPath()`**; no `..`, absolute paths or empty segments.
- **Purchases become paid only in the Stripe webhook**, idempotent per event id. Never pass payment method types; they're set in the Stripe Dashboard.
- **Creator money never touches Forgehub**: direct charges on the seller's connected account with `application_fee_amount`; only adults can connect.
- **Only the age group is stored, never a birthday.** Under 13s aren't kept.
- **Digital goods only.** No physical goods, game accounts or in-game currency.
- Suspended accounts' repos, items and profiles are hidden; owners can't be suspended.
- Never commit `.env`, `data/` or `*.db`.

## Style
Small modules, short comments that explain why, plain-language UI copy in sentence case, errors that say what to do next. Dark slate by default with a light theme, one green accent, rounded cards, Inter.
