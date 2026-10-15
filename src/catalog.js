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
  ai: {
    name: "Dedicated AI assistant", price: 10000,
    desc: "Your own branded AI assistant, plus 10 times the daily Forge mentor limit.",
  },
  showcase: {
    name: "Showcase slot", price: 1000,
    desc: "List one website or server in the ForgeCenter showcase.",
  },
};

export const modeOf = item => (item.monthly ? "subscription" : "payment");
