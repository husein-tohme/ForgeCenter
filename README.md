# ForgeCenter

Minecraft mods, websites, Discord bots, games, Minecraft server hosting and an AI coding mentor, all in one place.

## Features

- **Sign in with Google (Gmail), Microsoft, GitHub, Discord or WhatsApp.** Every account is backed by a real, verified identity, and no passwords are stored. Accounts with the same verified email are joined automatically, and people can connect several sign-in methods to one account.
- **Shop and Stripe Checkout** for every service. Hosting and website domains ($2/month) are monthly subscriptions.
- **Order tracking** at `/account`: status, a project brief, a message thread with you, and the delivery link.
- **Owner panel** at `/admin`: sales overview, support inbox, order status, delivery links, replies to customers, wallet refunds and credit, showcase approvals.
- **Age groups like Discord's**: a birthday question after the first sign-in turns away under-13s, and every account starts in the teen group. Adults confirm once with a Stripe credit card check or a Stripe Identity ID scan with a selfie. ForgeCenter keeps only the result. Big custom projects (configurable) and 18+ showcase listings are for confirmed adults, and the AI mentor and support assistant are told when someone is a teen.
- **Wallet**: store credit customers top up by card ($5 to $500 at a time, up to $2,000) and spend on one-time items in one step. You can refund orders as credit or give goodwill credit. It's closed-loop: no withdrawals or transfers.
- **Help desk** at `/support`: Forge Support (Claude) answers tickets straight away using built-in help notes and the customer's own orders, and hands anything involving money, broken services or a request for a person to you, with a note. You reply from the owner panel; customers get emails.
- **Self-service billing** through the Stripe Customer Portal (update card, cancel subscriptions, download invoices).
- **Mod Forge**: generate a Fabric mod in your name, download it or create a Modrinth draft.
- **Texture Forge** (`/textures`): a 16x16 pixel editor that exports a Minecraft resource pack.
- **Modpack Forge** (`/modpacks`): search Modrinth, pick Fabric mods, download a `.mrpack` with required dependencies added automatically.
- **Plugin Forge** (`/plugins`): makes a Paper/Purpur server plugin project with custom commands, a welcome message and timed announcements, all editable later in `config.yml`. The generated Java is compiled in the tests.
- Creations from all four tools are saved to the account when signed in.
- **Email notifications**: you get an email for new paid orders, customer messages and tickets that need you; customers get one for payment, status changes, your replies, wallet credit and failed renewals.
- **Forge AI mentor**: 30 free messages a day per account, 300 with the Dedicated AI purchase.
- **Showcase**: customers buy a slot, submit a listing, and it goes live after you approve it.
- **Privacy policy and terms** pages (required by Google for sign-in). Have a lawyer review them before launch.
- **Security**: CSRF protection, strict security headers, signed and replay-protected Stripe webhooks, rate limits, hashed session tokens.

## Delivering orders

Minecraft servers and Discord bots are set up automatically when they're paid for. Websites, games and AI assistants are built by you and delivered through the owner panel.

### Minecraft servers (Pterodactyl)

1. Rent a machine for game servers. Pick a provider with **DDoS protection** included (for example OVH Game or Hetzner with a protection add-on), because that protection comes from the network, not from software.
2. Install [Pterodactyl](https://pterodactyl.io) (panel and Wings) or its successor [Pelican](https://pelican.dev). Add a location and a node with a range of ports (allocations).
3. In the panel, note the IDs of the **nest** and **egg** to use (for example the Paper egg in the Minecraft nest) and of the **location**.
4. Create an **Application API key** (Admin > Application API) with read and write access to users, servers, nests, locations, nodes and allocations, and a **Client API key** on your admin account (Account > API Credentials).
5. Fill in the `PTERODACTYL_` settings in `.env`.

What happens automatically:
- **Payment:** a panel account is made for the customer and a server is created with 2 GB RAM, 100 GB storage and a dedicated CPU core. The customer gets an email with the address and can start, stop, restart and run commands from their account page.
- **Failed payment:** the server is suspended, and comes back as soon as a payment succeeds.
- **Cancelled subscription:** the server is suspended and deleted 7 days later.
- **Plugins:** customers search Modrinth for Paper/Purpur/Spigot plugins and install or remove them on their server from their order page, using the panel's download feature (make sure remote downloads are allowed in the panel's settings).
- **Errors:** they retry with growing waits. After 8 failures you get an email, and the owner panel shows the error with a Retry button. Retries never create duplicate servers.

### Discord bots

`templates/discord-bot/` is the bot every bot order gets: tickets with transcripts, button role menus, memes, moderation with warnings and logs, welcome messages, trivia and a coin economy.

1. Set `SECRET_KEY` in `.env` (tokens are stored encrypted with it).
2. Run `npm run setup:bots` once, then keep `npm run bots` running next to the website (same folder, same database).

After paying, the customer follows the steps on their order page to create a Discord application and paste its token. ForgeCenter checks the token and the required intent with Discord, stores it encrypted and shows an "Add to your server" link. The bot runner then:
- registers the slash commands and keeps one process per bot running, restarting crashes with growing waits;
- gives each bot only its own token and database, never the website's keys;
- shows customers their bot's status, recent errors and a Restart button.

Each bot uses about 60 to 100 MB of memory, so plan the machine size around how many you sell.

## Claude plugin

`claude-plugin/forgecenter` is a Claude Code plugin for working on this project:

- **`/forgecenter`** opens a launch checklist: which `.env` settings are still missing (never showing their values), whether the tests pass, and what isn't committed or pushed yet.
- **Secrets guard:** stops any commit or push that would include `.env`, `data/` or a database file.
- **Project rules guard:** stops edits to `src/` that would pass `payment_method_types` to Stripe or store a date of birth.
- **Status line:** shows the latest test result after the tests run.

Install it at the prompt of a Claude Code terminal session:

```
/plugin install forgecenter --marketplace husein-tohme/ForgeCenter
```

Or from a shell:

```bash
claude plugin install forgecenter --marketplace husein-tohme/ForgeCenter
```

Its tests run with `claude plugin test claude-plugin/forgecenter`.

## Try it in your browser (GitHub Codespaces)

No installing needed. On the repository page, choose **Code**, then the **Codespaces** tab, then **Create codespace** on this branch. After a couple of minutes ForgeCenter starts by itself and opens in a new tab at an address like `https://<name>-3000.app.github.dev`.

- The address is private to you. To share it, open the **Ports** tab, right-click port 3000 and set **Port visibility** to **Public**.
- Add your keys as [Codespaces secrets](https://github.com/settings/codespaces) (for example `GOOGLE_CLIENT_ID`, `STRIPE_SECRET_KEY`, `ANTHROPIC_API_KEY`) and restart the codespace; they're used ahead of `.env`. For Google sign-in, add the codespace address under Authorized JavaScript origins.
- A codespace stops after 30 minutes without use. It's a place to try things, not to run the real shop: use a host from **Deploy** for that.

## Run it on your computer

Needs Node.js 22.13 or newer. On Windows, `winget install OpenJS.NodeJS.LTS` and `winget install Git.Git` install both tools.

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
4. Put the client ID in `GOOGLE_CLIENT_ID` and your own email in `ADMIN_EMAILS`. Gmail accounts sign in through Google.

### More sign-in options (optional)
Each provider turns on when its two values are in `.env`. Register this redirect URL with each one: `https://YOUR-DOMAIN/api/auth/<provider>/callback` (and the `http://localhost:3000/...` version for testing).

- **GitHub:** Settings > Developer settings > OAuth Apps > New OAuth App. Callback: `/api/auth/github/callback`.
- **Microsoft (Outlook, Hotmail, Xbox, work accounts):** [Azure portal](https://portal.azure.com) > App registrations > New registration. Choose "Accounts in any organizational directory and personal Microsoft accounts", add a Web redirect URI `/api/auth/microsoft/callback`, then create a client secret. Only personal Microsoft accounts' emails are trusted for joining accounts and owner access, because work accounts can set any email.
- **Discord:** [Developer Portal](https://discord.com/developers/applications) > New Application > OAuth2. Add the redirect `/api/auth/discord/callback`.
- **WhatsApp:** needs a [WhatsApp Business account on the Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started). Create an *Authentication* message template with a copy-code button, then set `WHATSAPP_TOKEN` (a permanent system-user token), `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_TEMPLATE`. Meta charges per message, so `WHATSAPP_DAILY_LIMIT` caps how many codes go out each day. Codes expire after 10 minutes, lock after 5 wrong tries, and each number and device can request 3 or 10 codes an hour.

### Stripe
1. Create a **restricted key** and put it in `STRIPE_SECRET_KEY`. It needs write access to Checkout Sessions, Customers, Customer Portal, SetupIntents (read is enough), PaymentMethods (to remove the card after an age check) and Identity Verification Sessions, plus the Identity permission to read verified dates of birth.
2. Add a webhook endpoint at `https://YOUR-DOMAIN/api/stripe/webhook` for these events, and put its signing secret in `STRIPE_WEBHOOK_SECRET`:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
   `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`,
   `charge.dispute.created`, `charge.dispute.closed`,
   `identity.verification_session.verified`, `identity.verification_session.requires_input`,
   `identity.verification_session.canceled`.
   Webhooks are required: they are how orders, subscriptions, wallet top-ups and age checks get their results.
3. Turn on the **Customer Portal** in Settings > Billing > Customer portal.
4. For local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
5. **Taxes:** if you sell to customers in the US or EU, look at Stripe Tax before launch. It only collects tax once you have registrations set up.

### Age checks
- **Credit card check** works as soon as Stripe is set up. It runs Checkout in setup mode, so nobody is charged, then removes the card. Only credit cards pass, because card issuers only give those to adults. Customers who pay with a card wallet such as Link may be asked to use a plain credit card instead.
- **ID scan** needs [Stripe Identity](https://dashboard.stripe.com/identity) turned on for your account (Stripe charges per check). ForgeCenter reads the date of birth once to decide adult or not, never stores it, and then redacts the session so Stripe deletes the images.
- `ADULT_ONLY_PRODUCTS` chooses what only confirmed adults can buy (default `game,website,roblox,launcher`, the big custom projects, since minors can back out of contracts). Leave it empty to allow everything.
- Someone who says they're under 13 has their new account deleted, and that browser can't try again for a day. An older account with paid subscriptions or credit is locked instead, and you get an email to refund it.

### Wallet
Top-ups go through Stripe Checkout and are added by the webhook. To refund unused credit, refund the top-up's payment in the Stripe Dashboard: the wallet goes down by the same amount automatically. If a customer disputes a top-up with their bank, its credit is taken back until the dispute closes, and you get an email. Refunds for orders can be given as credit from the order in the owner panel, and goodwill credit from any support ticket. Check with an accountant how your state treats unused store credit.

### Forge mentor and Forge Support
Put an Anthropic API key in `ANTHROPIC_API_KEY`. The mentor uses `AI_MODEL` and Forge Support uses `SUPPORT_AI_MODEL` (default `claude-opus-5-5`, with Anthropic's automatic fallback model if it declines a request). Each customer gets up to 40 Forge Support replies a day and 5 open tickets. Without a key, tickets go straight to you.

### Email (optional)
Create a free [Resend](https://resend.com) account, verify your domain, and set `RESEND_API_KEY` and `EMAIL_FROM`. Without them the site works the same, just without emails.

## Deploy

With Docker on a VPS: fill in `.env` (with `NODE_ENV=production`), run `docker compose up -d --build`, and put an HTTPS reverse proxy such as Caddy in front of port 3000. Accounts, orders and bot data live in the `forgecenter-data` volume.

Any Node 22 host works (Render, Railway, Fly.io, a VPS). Run two processes from the same folder: `npm start` (the website) and `npm run bots` (customer Discord bots). The included `Procfile` does this on hosts that read it. Set `NODE_ENV=production` (this makes the sign-in cookie HTTPS-only), set `BASE_URL` to your domain, and put `DATABASE_PATH` on a **persistent disk** so accounts and orders survive restarts.

## Not built yet

- NeoForge and Quilt modpacks (Modpack Forge is Fabric only for now)
