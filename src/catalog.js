// Products and prices (USD cents). Edit here to change pricing site-wide.
// price = one-time charge, monthly = recurring charge. Each product is its own
// line item in Stripe so receipts show clear names.
export const catalog = {
  website: {
    name: "Fully furnished website", price: 100000,
    monthly: 200, monthlyName: "Website domain",
    desc: "Complete site with payments, billing, a built-in AI assistant and your own domain. The domain is $2 a month.",
  },
  game: {
    name: "Fully furnished game (deposit)", price: 1000000,
    desc: "Custom game, $10,000 to $20,000 depending on scope, launched on Steam with payments set up. This deposit starts the project.",
  },
  discord: {
    name: "Discord bot", price: 10000,
    desc: "Hosted 24/7 with tickets, memes, reaction roles, moderation and mini-games.",
  },
  mcserver: {
    name: "Minecraft server hosting", monthly: 10000, monthlyName: "Minecraft server hosting",
    desc: "10 players, 2 GB RAM, 100 GB storage, a dedicated CPU and DDoS protection. Billed monthly.",
  },
  roblox: {
    name: "Custom Roblox game (deposit)", price: 200000,
    desc: "A Roblox game built for you, $2,000 to $8,000 depending on scope, published to your Roblox group with game passes set up. This deposit starts the project.",
  },
  launcher: {
    name: "Custom Minecraft launcher", price: 50000,
    desc: "Your own branded launcher for your server or modpack: your logo and news, one-click install and updates, for Windows, macOS and Linux.",
  },
  ai: {
    name: "Dedicated AI assistant", price: 10000,
    desc: "Your own branded AI assistant, plus 10 times the daily Forge mentor limit.",
  },
  showcase: {
    name: "Showcase slot", price: 1000,
    desc: "List one website or server in the ForgeCenter showcase.",
  },
  // Bought per game from My games (src/launchpad.js), not from the shop.
  launch: {
    name: "Game launch", monthly: 100, monthlyName: "Game launch",
    desc: "Launch your game on the ForgeCenter games page for $1 a month. Cancel any time; it stays up until the end of the month you've paid for.",
    ownFlow: true,
  },
};

export const modeOf = item => (item.monthly ? "subscription" : "payment");

// Products only adults can buy (age confirmed by a credit card check or an ID scan).
// Big projects are contracts, and minors can back out of contracts.
export const isAdultOnly = key =>
  (process.env.ADULT_ONLY_PRODUCTS ?? "game,website,roblox,launcher").split(",").map(s => s.trim()).includes(key);

// One-time products can be paid with orbs; monthly plans go through Stripe.
export const walletPayable = item => !!item?.price && !item.monthly;

// Orbs are ForgeCenter's own currency: 1 orb = 1 US cent, so wallet amounts in cents are
// orb counts. "2,500 orbs", "1 orb", "−300 orbs".
export const orbs = n => `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US")} ${Math.abs(n) === 1 ? "orb" : "orbs"}`;
// The dollar value, for the small print next to an orb amount: "$25", "$25.50".
export const usd = cents => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
// The most orbs an account can hold (WALLET_LIMITS in wallet.js). Something that costs
// more, like a game deposit, can't really be paid with orbs, so it isn't offered.
export const MAX_ORBS = 200000;
export const orbPayable = item => walletPayable(item) && item.price <= MAX_ORBS;

export const publicCatalog = () => Object.fromEntries(Object.entries(catalog).map(([key, item]) =>
  [key, { ...item, adultOnly: isAdultOnly(key), walletPayable: walletPayable(item), orbPayable: orbPayable(item) }]));
