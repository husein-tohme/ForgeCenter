# ForgeCenter

One place for Minecraft mods, websites, Discord bots, games, Minecraft server hosting and an AI coding mentor.

## What works today
- **Storefront + pricing** (`src/catalog.js`): website $1,000, game from $10,000 deposit, Discord bot $100, Minecraft hosting $100/mo, dedicated AI $100, showcase slot $10.
- **Stripe Checkout** for every product (monthly subscription for hosting).
- **Mod Forge**: generates a Fabric mod project (items, lang, `fabric.mod.json`, license) in the user's name, and can create a **draft** Modrinth project with the user's own token.
- **Forge AI mentor**: coding tutor powered by the Claude API.

## Run
```bash
npm install
cp .env.example .env   # fill in your Stripe + Anthropic keys
node --env-file=.env src/server.js
```
Open http://localhost:3000.

## Roadmap
- Accounts + order dashboard, Stripe webhooks to track fulfillment
- Minecraft server provisioning (Pterodactyl panel on dedicated hardware)
- Discord bot template deployment per customer
- Website builder + hosting, showcase gallery
- Resource pack / modpack generators
