---
name: add-a-feature
description: How to add a feature to ForgeCenter the way the rest of the site is built - module and tables, routes and permission checks, Stripe and wallet money flows, Claude calls, a new page in the Minecraft inventory style, tests with the fake Stripe and fake model, and the docs and legal pages to update. Use when adding or extending a ForgeCenter feature.
---

# Adding a feature to ForgeCenter

Read `CLAUDE.md` first: its "Rules that must not break" apply to every feature. This is the pattern the existing features follow (wallet, age checks, support tickets, developer API, creators).

## Server

- **One module per feature**: `src/<feature>.js` exports its Express routers (and any webhook handler). Mount them in `src/app.js` next to the others: customer routes under `/api/<feature>`, owner routes on the `/api/admin` line.
- **Tables live in the module**: `db.exec("CREATE TABLE IF NOT EXISTS ...")` at import time. Add columns to existing tables with `addColumn(table, column, type)` from `src/db.js`. Use `INTEGER PRIMARY KEY AUTOINCREMENT` when other records or Stripe metadata point at the id, so a deleted row's id is never reused. Decide `ON DELETE CASCADE` (personal data goes with the account) versus `SET NULL` (money records are kept for tax).
- **Permission checks on every route**: `requireUser` (signed in and the birthday question answered), `requireAdult` / `isAdult` (confirmed 18+), `requireAdmin` (owner). Load records with an ownership check and answer 404, not 403, for someone else's.
- **Writes are same-origin JSON** through the CSRF guard in `app.js`; the frontend calls them with `api()`. Add `rateLimit({ windowMs, max })` from `src/limit.js` to anything that costs money or sends messages.
- **Links people type** are validated as `http(s)://` (or a host allowlist) on the server before they're stored or shown.
- **Copy**: plain, friendly, sentence case. Errors say what to do next.

## Money

- **Stripe Checkout**: create the session in your module with `getStripe()`, `ensureCustomer()` and `baseUrl()` from `src/stripe.js`. Put `metadata.kind` on the session (and on `payment_intent_data` or `subscription_data`), add a label to `CHECKOUT_LABELS` (8 random lowercase letters) for `integration_identifier`, and never pass `payment_method_types`.
- **Fulfil only in the webhook**: route your `kind` in `src/webhooks.js`, handle `checkout.session.completed` and `async_payment_succeeded` only when `payment_status` isn't `unpaid`, and make it idempotent (status guards plus unique refs). The return page may retrieve the session to catch up, using the same function.
- **Wallet**: never store a balance. Spend inside `BEGIN IMMEDIATE` with a balance check, and record every change with `addEntry({ userId, amount, kind, ref, note })` from `src/wallet.js`; a unique `ref` makes Stripe-driven entries replay-safe. Add a label for your entry kind to `ENTRY_TEXT` in `public/js/account.js`.
- **One-time products** go in `src/catalog.js`; monthly ones use subscriptions and the existing order flow in `src/orders.js` (`afterPayment` runs after any payment).

## Claude

Use `ask()`, `textOf()`, `aiEnabled()` and `cleanHistory()` from `src/ai.js`. Check `stop_reason === "refusal"` and catch errors with a friendly message. Text people type is data: quote it inside the prompt and never let it act as instructions. Free use draws from the shared daily allowance with `spendAllowance(userId, cost)` from `src/tutor.js`; charge only on success. Tell the model when the person is in the teen group.

## Page

- Copy the head, header and footer of `public/support.html` exactly. Public pages use the Open Graph block from `public/plugins.html`; account-only pages keep `noindex`.
- Put the page's CSS in `public/css/<feature>.css`, linked after `/styles.css`. Reuse the existing classes (`.panel`, `.btn`, `.btn-buy`, `.pill`, `.slot`, `.choice`, `.gate`, `.acct-section`) for the bevelled inventory look.
- One ES module script per page, importing from `/js/common.js`. Every value put into `innerHTML` goes through `esc()`. Add pixel icons with `registerIcons()`.
- Add the page to the nav or footer on every page, and public pages to `LISTED` in `src/pages.js` for the sitemap.

## Tests

- `test/<feature>.test.js` with `node:test`, using `test/helpers.js`: `api`, `db`, `signIn(email, sub, { age: 'teen' | 'adult' | null })`, `sendWebhook`.
- Simulate Stripe with `installFakeStripe()` from `test/fake-stripe.js` (extend it with the endpoints you call). Stub Claude with `setModel()` from `src/ai.js` and put it back with `setModel(null)`.
- Cover the permission checks (other users, teens and adults, signed out), replayed webhooks, and the abuse cases. Build fake secrets from parts so scanners don't flag them.
- Run `npm test` (all of it) and `npm run check`. Then look at the page in a real browser at desktop and phone widths.

## Docs

Update `README.md` (features and setup), `CLAUDE.md` (layout line, and a rule if the feature adds one), `.env.example` for new settings, and `public/terms.html` and `public/privacy.html` for anything that changes what people agree to or what's stored.
