// Self-service help articles, shown on the Help page and linked by Forge Support
// (src/support.js imports the titles). Plain data so both can use it: blocks are
// { h }, { p }, { steps: [] }, { list: [] } or { note }. In text, **bold** marks a button
// or label, and [words](/path) links to a page on this site.
export const ARTICLES = [
  {
    id: "join-server",
    title: "How to join your Minecraft server and add plugins",
    tags: "minecraft server address ip join connect multiplayer plugins install paper purpur spigot restart offline suspended",
    summary: "Find your server's address, join it from Minecraft, and install plugins from Modrinth.",
    body: [
      { h: "Join your server" },
      { steps: [
        "Open [My account](/account) and open your **Minecraft server hosting** order.",
        "Next to the address, press **Copy**.",
        "In Minecraft Java Edition, open **Multiplayer**, choose **Add Server**, and paste the address.",
        "Press **Done**, then join the server from the list.",
      ] },
      { p: "If the server shows **Offline**, press **Start** in the order and give it a minute." },
      { h: "Add plugins" },
      { steps: [
        "In the same order, open **Plugins**.",
        "Search for a plugin. Results are Paper, Purpur and Spigot plugins from Modrinth.",
        "Press **Install**, then **Restart** the server so the plugin turns on.",
      ] },
      { note: "Made your own plugin with [Plugin Forge](/plugins)? Upload its .jar file in the server's control panel." },
      { h: "Common problems" },
      { list: [
        "**Your server is being set up**: new servers take a few minutes. You'll get an email when it's ready.",
        "**Your server is paused**: a monthly payment didn't go through. Update your card under **Manage billing** and it comes back on.",
        "**Setting up your server hit a problem**: ForgeCenter has already been told and will fix it. There's nothing you need to do.",
      ] },
    ],
  },
  {
    id: "discord-bot",
    title: "How to switch on your Discord bot",
    tags: "discord bot token setup intent invite add to server offline crashed restart reset token",
    summary: "Create the bot in Discord's Developer Portal, paste its token, and add it to your server.",
    body: [
      { steps: [
        "Open the [Discord Developer Portal](https://discord.com/developers/applications) and choose **New Application**. Give it your bot's name.",
        "On the **Bot** page, turn on **Server Members Intent** and **Message Content Intent**, then save.",
        "On the same page, choose **Reset Token** and copy the token. Treat it like a password.",
        "Open your **Discord bot** order on [My account](/account), paste the token and press **Switch on my bot**.",
        "Press **Add the bot to your server** and pick your server.",
        "In Discord, drag the bot's role above the roles it should hand out, then run **/setup**.",
      ] },
      { h: "If your bot shows Crashed or Stopped" },
      { list: [
        "Press **Restart bot** in the order.",
        "If the token stopped working, reset it in the Developer Portal and paste the new one under **Replace the token**.",
        "Check both intents are still turned on.",
      ] },
      { note: "Never share your bot token in a ticket or anywhere else. ForgeCenter stores it encrypted and never shows it again." },
    ],
  },
  {
    id: "wallet",
    title: "How to buy and spend orbs",
    tags: "orbs orb xp currency wallet balance buy add funds top up credit pay with orbs store credit limit refund ai messages",
    summary: "Orbs are ForgeCenter's own currency. Buy a pack by card, then spend orbs on one-time items and extra AI messages.",
    body: [
      { p: "1 orb is worth 1 US cent, so 2,500 orbs cost $25. See everything you can get with orbs on the [orbs page](/orbs)." },
      { h: "Buy orbs" },
      { steps: [
        "Open the [orbs page](/orbs), or [My account](/account) and scroll to **Orbs**.",
        "Choose a pack, or type a number of orbs under **Other amount**.",
        "Pay by card on the Stripe page. You'll come back to ForgeCenter, and your orbs show up in a few seconds.",
      ] },
      { list: [
        "You can buy 500 to 50,000 orbs at a time, in hundreds, and hold up to 200,000.",
        "Orbs never expire, but they can't be withdrawn, sold or sent to someone else.",
      ] },
      { h: "Spend orbs" },
      { p: "When you have enough orbs for the whole price of a one-time item, like a Discord bot, the Dedicated AI assistant or a showcase slot, pressing **Trade** asks how you want to pay. Choose **Pay with orbs**. Monthly plans are always paid by card." },
      { h: "Keep chatting when your free AI messages run out" },
      { p: "The Forge mentor, AI Maker and Site Maker share a free daily allowance. Turn on **When my free AI messages run out, use orbs** in the Orbs section of your account, and each extra message costs a few orbs (the price is shown next to the setting). If the AI fails, you get those orbs back." },
      { note: "Want an unused orb pack refunded to your card? Open a support ticket and a person will refund it." },
    ],
  },
  {
    id: "confirm-age",
    title: "How to confirm you're an adult (and why your account says Teen)",
    tags: "age teen adult confirm verify verification credit card id scan selfie stripe identity 18 debit",
    summary: "Your birthday sets your group: 18 and over is adult, 13 to 17 is teen. If you've turned 18 since, here's how to confirm.",
    body: [
      { p: "When you first sign in you give your birthday once: 18 and over gets an adult account, 13 to 17 a teen account. If you've turned 18 since, confirm your age once to buy big custom projects and to see 18+ showcase listings." },
      { steps: [
        "Open [My account](/account) and find **Age group**.",
        "Press **Confirm your age**.",
        "Choose **Credit card** or **ID scan** and follow the steps on Stripe's page.",
      ] },
      { list: [
        "**Credit card**: you aren't charged, and the card isn't saved. Your bank may show a small temporary hold that disappears on its own. Debit and prepaid cards don't count, because only credit cards are limited to adults.",
        "**ID scan**: scan a photo ID and take a selfie. ForgeCenter only learns whether you're 18 or over, and asks Stripe to delete the images straight after. The result can take a few minutes.",
      ] },
      { note: "If your ID shows you're under 18, your account stays in the teen group. Using someone else's card or ID isn't allowed." },
    ],
  },
  {
    id: "cancel-subscription",
    title: "How to cancel or change a monthly plan",
    tags: "cancel subscription monthly plan hosting domain game launch billing card invoice manage billing stripe portal",
    summary: "Use Manage billing to update your card, download invoices or cancel a monthly plan.",
    body: [
      { steps: [
        "Open [My account](/account) and press **Manage billing**.",
        "On Stripe's billing page, update your card, download invoices or cancel a plan.",
      ] },
      { list: [
        "Cancelling stops the next payment. You keep the service until the end of the month you've paid for.",
        "A cancelled Minecraft server is paused, then deleted 7 days later. Download anything you want to keep first.",
        "There's no refund for the month you're in.",
      ] },
      { note: "Don't see **Manage billing**? It appears after your first card payment." },
    ],
  },
  {
    id: "refunds",
    title: "Can I get a refund?",
    tags: "refund money back cancel order chargeback dispute wallet orbs credit donation mistake",
    summary: "What you can get back, and how to ask.",
    body: [
      { p: "If work on your order hasn't started yet, yes: you get a full refund. Ask in the order's messages or open a support ticket." },
      { list: [
        "**Work has started**: you get back the part that hasn't been done yet.",
        "**Monthly plans**: not refunded for the month you're in. Cancelling stops the next payment.",
        "**Unused orb packs**: refunded to the card they came from, on request.",
        "**Donations**: only refunded if made by mistake, within 14 days.",
      ] },
      { p: "Refunds go back to your card, or into your account as orbs if you'd rather have that." },
      { note: "Please talk to us before disputing a payment with your bank. A refund is quicker for everyone." },
    ],
  },
  {
    id: "sign-in",
    title: "Can't sign in? Fix sign-in problems and add a backup sign-in",
    tags: "sign in log in login can't access locked out google gmail microsoft github discord whatsapp code expired account connected",
    summary: "Common sign-in errors, and how to connect more ways to sign in so you never get locked out.",
    body: [
      { p: "ForgeCenter has no passwords. You sign in with Google (including Gmail), Microsoft, GitHub, Discord or a WhatsApp code." },
      { h: "Common errors" },
      { list: [
        "**That sign-in took too long or was opened in another browser**: start again, and finish in the same browser tab.",
        "**That account is already connected to a different ForgeCenter account**: you've used it on another ForgeCenter account. Sign in with that one instead.",
        "**WhatsApp code didn't arrive or stopped working**: codes last 10 minutes and lock after 5 wrong tries. You can ask for 3 codes an hour.",
        "**Google button doesn't show**: if you use a content blocker, allow accounts.google.com.",
      ] },
      { h: "Add a backup sign-in" },
      { steps: [
        "Open [My account](/account) and find **Sign-in methods**.",
        "Under **Connect another**, choose a second way to sign in.",
      ] },
      { note: "Accounts with the same verified email are joined automatically." },
    ],
  },
  {
    id: "delete-account",
    title: "How to delete your account",
    tags: "delete account remove close data privacy erase gdpr",
    summary: "What has to happen first, and what's removed.",
    body: [
      { steps: [
        "Cancel any monthly plans under **Manage billing**.",
        "Spend your orbs, or open a support ticket to have unused orb packs refunded. Your balance needs to be at exactly 0 orbs.",
        "Open [My account](/account), scroll to the bottom and press **Delete my account**.",
      ] },
      { p: "Your profile, saved creations, showcase listings, messages, support tickets and age checks are removed, and your game server panel login is switched off. Records of past payments are kept for tax law, without your name, project briefs or messages." },
      { note: "Deleting can't be undone. More details are in the [privacy policy](/privacy)." },
    ],
  },
];
