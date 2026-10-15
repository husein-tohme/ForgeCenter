# ForgeCenter

Minecraft mods, websites, Discord bots, games, Minecraft server hosting and an AI coding mentor, all in one place.

## Features

- **Google sign-in only.** Every account is a real, verified Google account. No passwords are stored.
- **Shop and Stripe Checkout** for every service. Hosting and website domains ($2/month) are monthly subscriptions.
- **Order tracking** at `/account`: status, a project brief, a message thread with you, and the delivery link.
- **Owner panel** at `/admin`: update order status, add delivery links, reply to customers, approve showcase listings.
- **Self-service billing** through the Stripe Customer Portal (update card, cancel subscriptions, download invoices).
- **Mod Forge**: generate a Fabric mod in your name, download it or create a Modrinth draft.
- **Texture Forge** (`/textures`): a 16x16 pixel editor that exports a Minecraft resource pack.
- **Modpack Forge** (`/modpacks`): search Modrinth, pick Fabric mods, download a `.mrpack` with required dependencies added automatically.
- Creations from all three tools are saved to the account when signed in.
- **Email notifications**: you get an email for new paid orders and customer messages; customers get one for payment, status changes, your replies and failed renewals.
- **Forge AI mentor**: 30 free messages a day per account, 300 with the Dedicated AI purchase.
- **Showcase**: customers buy a slot, submit a listing, and it goes live after you approve it.
- **Privacy policy and terms** pages (required by Google for sign-in). Have a lawyer review them before launch.
- **Security**: CSRF protection, strict security headers, signed and replay-protected Stripe webhooks, rate limits, hashed session tokens.

## Run it locally

Needs Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env   # then fill in your keys
npm run dev
npm test               # automated tests
```

Open http://localhost:3000.

## Set up the services

### Google sign-in
1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), configure the OAuth consent screen. Use `/privacy` and `/terms` on your domain as the policy links.
2. Create an **OAuth client ID** of type *Web application*.
3. Under **Authorized JavaScript origins**, add `http://localhost:3000` and your real domain.
4. Put the client ID in `GOOGLE_CLIENT_ID` and your own email in `ADMIN_EMAILS`.

### Stripe
1. Create a **restricted key** with write access to Checkout Sessions, Customers and Customer Portal. Put it in `STRIPE_SECRET_KEY`.
2. Add a webhook endpoint at `https://YOUR-DOMAIN/api/stripe/webhook` for these events, and put its signing secret in `STRIPE_WEBHOOK_SECRET`:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
   `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
   Webhooks are required: they are how orders and subscriptions get marked paid, failed or canceled.
3. Turn on the **Customer Portal** in Settings > Billing > Customer portal.
4. For local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
5. **Taxes:** if you sell to customers in the US or EU, look at Stripe Tax before launch. It only collects tax once you have registrations set up.

### Forge mentor
Put an Anthropic API key in `ANTHROPIC_API_KEY`.

### Email (optional)
Create a free [Resend](https://resend.com) account, verify your domain, and set `RESEND_API_KEY` and `EMAIL_FROM`. Without them the site works the same, just without emails.

## Deploy

Any Node 22 host works (Render, Railway, Fly.io, a VPS). Set `NODE_ENV=production` (this makes the sign-in cookie HTTPS-only), set `BASE_URL` to your domain, and put `DATABASE_PATH` on a **persistent disk** so accounts and orders survive restarts.

## Not built yet

- Automatic provisioning of Minecraft servers and Discord bots (orders are fulfilled by you through the owner panel for now)
- NeoForge and Quilt modpacks (Modpack Forge is Fabric only for now)
