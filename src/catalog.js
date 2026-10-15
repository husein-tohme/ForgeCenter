// Products and prices (USD cents). Edit here to change pricing site-wide.
export const catalog = {
  website: {
    name: "Fully furnished website", price: 100000, mode: "payment",
    desc: "Complete site with payments, billing, built-in AI assistant and a domain ($2/mo domain fee billed separately).",
  },
  game: {
    name: "Fully furnished game (deposit)", price: 1000000, mode: "payment",
    desc: "Custom game, $10,000–$20,000 depending on scope. Includes Steam launch and payment setup. This is the starting deposit.",
  },
  discord: {
    name: "Discord bot", price: 10000, mode: "payment",
    desc: "Hosted 24/7: tickets, memes, reaction roles, moderation, mini-games.",
  },
  mcserver: {
    name: "Minecraft server hosting", price: 10000, mode: "subscription",
    desc: "10 players, 2 GB RAM, 100 GB storage, dedicated CPU, DDoS protection. Billed monthly.",
  },
  ai: {
    name: "Dedicated AI assistant", price: 10000, mode: "payment",
    desc: "Your own branded AI assistant with higher usage limits.",
  },
  showcase: {
    name: "Showcase slot", price: 1000, mode: "payment",
    desc: "List a website or server on the ForgeCenter showcase.",
  },
};
