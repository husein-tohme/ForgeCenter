# ForgeCenter Discord Bot

This is the bot customers get when they buy the **Discord bot** product: tickets, memes, reaction roles, moderation, welcome messages and mini-games. Make one copy of this folder per customer, give it that customer's bot token, and keep it running.

Customers set everything up from inside Discord with `/setup`. Nobody needs to edit code.

## What it does

| Feature | Commands | In short |
| --- | --- | --- |
| Tickets | `/ticket panel` | Posts an **Open ticket** button. Each click makes a private channel for that member and the staff role, with **Claim** and **Close** buttons. When a ticket closes, a `.txt` transcript goes to the log channel. One open ticket per member. |
| Reaction roles | `/roles panel` | The admin picks up to 25 roles. Members press a button to get a role, and press it again to remove it. The bot refuses unsafe roles (admin/moderator permissions, roles above the bot). |
| Memes and fun | `/meme` `/8ball` `/coinflip` `/roll` | `/meme` pulls a random safe-for-work meme from meme-api.com. NSFW and spoiler posts are always skipped. |
| Moderation | `/warn` `/warnings` `/timeout` `/kick` `/ban` `/purge` | Checks permissions and the role hierarchy, asks for reasons, saves warnings, and logs every action to the log channel. |
| Welcome | `/setup welcome` `/setup autorole` | Greets new members with a custom message and can give them a role automatically. |
| Games and coins | `/trivia` `/rps` `/daily` `/balance` `/leaderboard` | 33 kid-friendly trivia questions (16 about Minecraft) with a 20-second timer. Right answers and `/daily` earn coins. |
| Utility | `/help` `/serverinfo` `/userinfo` `/ping` | |

Admin and moderator commands are hidden from regular members by default.

## What you need

- **Node.js 22.13 or newer** (`node --version` to check). The bot uses Node's built-in SQLite, so you don't need a database server.
- A Discord account.
- Somewhere to run it 24/7 (see [Keep it running 24/7](#keep-it-running-247)).

---

## 1. Create the bot in the Discord Developer Portal

Do this once per customer.

1. Go to <https://discord.com/developers/applications> and click **New Application**. Use the customer's bot name. You can set an avatar on the **General Information** page.
2. On **General Information**, copy the **Application ID**. This is your `CLIENT_ID`.
3. Open the **Bot** page:
   - Click **Reset Token** and copy the token. This is your `DISCORD_TOKEN`. **Treat it like a password.** Anyone who has it can control the bot. If it ever leaks, reset it again.
   - Under **Privileged Gateway Intents**, turn on:
     - **Server Members Intent**: needed for welcome messages and the auto-role. The bot **won't start** without it.
     - **Message Content Intent**: needed so ticket transcripts contain the text people wrote. Without it, transcripts only show "(no text)".
     - Leave **Presence Intent** off. It isn't needed.
   - Click **Save Changes**.
   - **Public Bot**: leave it on until the customer has added the bot to their server, then turn it off so strangers can't add it.

## 2. Invite the bot to the customer's server

Replace `YOUR_CLIENT_ID` with the Application ID and open this link (or send it to the customer):

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=1099780189206&integration_type=0&scope=bot+applications.commands
```

The bot also prints this exact link in its log every time it starts.

`1099780189206` is exactly the permissions the bot needs, and nothing more. It does **not** ask for Administrator.

| Permission | Why |
| --- | --- |
| View Channels, Send Messages, Embed Links | Replying to commands |
| Attach Files, Read Message History | Ticket transcripts, `/purge` |
| Manage Messages | `/purge` |
| Manage Channels | Creating and deleting ticket channels |
| Manage Roles | Reaction roles and the auto-role |
| Kick Members, Ban Members, Timeout Members | `/kick`, `/ban`, `/timeout` |

**Important:** Discord only lets a bot manage roles and members that are *below* its own role. In **Server Settings > Roles**, drag the bot's role above every role it should hand out and above the members it should moderate. The bot tells you clearly when this is the problem.

## 3. Install and configure

```bash
cd discord-bot                # this folder (copied per customer)
npm ci                        # installs discord.js, the only dependency
cp .env.example .env
```

Open `.env` and fill it in:

| Setting | Required? | What to put |
| --- | --- | --- |
| `DISCORD_TOKEN` | Yes | The token from step 1 |
| `CLIENT_ID` | Yes | The Application ID from step 1 |
| `GUILD_ID` | Recommended | The customer's server ID. With it, commands appear instantly in that server. |
| `DATABASE_PATH` | No | Where the database file is kept. Default: `data/bot.db` inside this folder. |
| `DAILY_COINS`, `TRIVIA_REWARD` | No | Coins from `/daily` (default 100) and a right trivia answer (default 25) |
| `MEME_SUBREDDITS` | No | Which subreddits `/meme` uses. Default: `wholesomememes,memes,MinecraftMemes` |

**To find the server ID:** in Discord, open **User Settings > Advanced** and turn on **Developer Mode**. Then right-click the server icon and choose **Copy Server ID**.

## 4. Register the slash commands

```bash
npm run register
```

- If `GUILD_ID` is set, the commands are added to that one server and show up right away.
- If `GUILD_ID` is empty, they're registered for every server the bot is in. This can take up to an hour.
- `npm run register:global` always registers globally. If you switch from server-only to global, run `npm run register -- --clear-guild` afterwards, or each command will show up twice in that server.

Run it again whenever you update the bot and the commands change. Running it again is always safe.

## 5. Start it

```bash
npm start
```

You should see something like:

```
[db] Using /home/you/discord-bot/data/bot.db
[ready] Logged in as ForgeBot#1234, in 1 server(s).
[ready] Invite link: https://discord.com/oauth2/authorize?client_id=...
```

Try `/ping` in the server. Then do the [customer setup](#for-the-customer-setting-up-the-bot) or hand it over to the customer.

To check everything works without Discord, run `npm test`.

---

## Keep it running 24/7

The bot only needs to make outgoing connections. It doesn't need a website, domain or open ports. A small VPS with 512 MB of RAM can run several customers' bots.

### Option A: a VPS with pm2 (recommended)

This works on any Ubuntu/Debian server (DigitalOcean, Hetzner, Linode and so on).

```bash
# 1. Install Node.js 22 (once per server)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

# 2. Put this folder on the server (scp, rsync or git), then inside it:
npm ci --omit=dev
cp .env.example .env && nano .env      # fill it in
npm run register

# 3. Start it and make it survive reboots
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup                            # prints one command: copy and run it
```

Useful pm2 commands: `pm2 logs discord-bot`, `pm2 restart discord-bot`, `pm2 status`.

**Several customers on one server:** give each customer their own copy of the folder, with its own `.env` and token. Change `name` in each copy's `ecosystem.config.cjs` (for example `bot-steve`, `bot-alex`). Each copy keeps its own `data/bot.db`.

### Option B: systemd (no pm2)

Save this as `/etc/systemd/system/discord-bot-CUSTOMER.service`, adjusting the paths and user:

```ini
[Unit]
Description=Discord bot for CUSTOMER
After=network-online.target
Wants=network-online.target

[Service]
User=botuser
WorkingDirectory=/opt/discord-bot-CUSTOMER
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning src/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Then run `sudo systemctl daemon-reload && sudo systemctl enable --now discord-bot-CUSTOMER`. To see the logs: `journalctl -u discord-bot-CUSTOMER -f`.

### Option C: Docker

```bash
docker build -t bot-customer .
docker run -d --name bot-customer --restart unless-stopped \
  --env-file .env -v bot-customer-data:/app/data bot-customer
```

The `-v ...:/app/data` part keeps the database when you rebuild or update the container. Register commands from your own computer with `npm run register`, or with `docker run --rm --env-file .env bot-customer node src/register.js`.

### Option D: Railway

1. Push this folder to a private GitHub repo, then on Railway choose **New Project > Deploy from GitHub repo**. Railway finds the `Dockerfile` by itself.
2. Under **Variables**, add `DISCORD_TOKEN`, `CLIENT_ID` and `GUILD_ID`.
3. Add a **Volume** to the service mounted at `/app/data`. Without one, the database is wiped on every deploy.
4. Railway volumes are owned by root, and this image runs as the safer `node` user. If the log shows a permission error for `/app/data`, add the variable `RAILWAY_RUN_UID=0`.
5. You don't need a public domain or port.

### Backups

All saved data is in one file (`data/bot.db`, plus `bot.db-wal`/`bot.db-shm` while the bot runs). To back it up, stop the bot and copy the `data` folder. Ticket transcripts aren't stored on disk; they go to the server's log channel.

---

## For the customer: setting up the bot

*Send this section to the customer.* Only people with **Manage Server** can use `/setup`. Every reply from `/setup` is private.

1. **Log channel** (do this first): `/setup logs channel:#mod-logs`. Moderation actions and ticket transcripts are posted here, so make it a staff-only channel.
2. **Tickets:**
   - Make a category (for example "Tickets") and a staff role.
   - Run `/setup tickets category:Tickets staff_role:@Staff`.
   - In your support channel, run `/ticket panel` (you can add a `title` and `description`). Members click **Open ticket** to get a private channel with your staff.
   - Tip: turn on "Allow anyone to @mention this role" for the staff role if you want staff pinged when a ticket opens.
3. **Self-assignable roles:** in the channel where the panel should go, run `/roles panel title:Pick your games` and choose up to 25 roles from the menu. The bot's role must be above those roles in **Server Settings > Roles**.
4. **Welcome messages:** `/setup welcome channel:#welcome message:Welcome {user} to {server}!`
   - Placeholders: `{user}` (mentions them), `{username}`, `{server}`, `{membercount}`. Type `\n` for a new line.
   - Leave out `message` to use the default greeting. The bot shows you a preview.
5. **Auto-role:** `/setup autorole role:@Member` gives every new member that role.
6. **Check or undo:** `/setup view` shows all settings. `/setup off` turns a feature off.

**Who can use what:** setup, ticket and role-panel commands need Manage Server or Manage Roles. Moderation commands need the matching Discord permission (for example Ban Members for `/ban`). Everyone can use the fun, games and utility commands. To change this, go to **Server Settings > Integrations > (the bot) > Command Permissions**.

**Moderation:** `/warn`, `/warnings list|remove|clear`, `/timeout user duration:10m` (`off` removes a timeout, max 28 days), `/kick`, `/ban` (optionally deletes recent messages), and `/purge amount:1-100` (optionally only one person's messages). Discord doesn't allow bulk-deleting messages older than 14 days.

---

## Troubleshooting

| What you see | Fix |
| --- | --- |
| `Disconnected for good (code 4014)` or "disallowed intents" | Turn on **Server Members Intent** (and **Message Content Intent**) on the Developer Portal's Bot page, then restart. |
| `Could not log in` / "invalid token" | Reset the token on the Bot page and update `DISCORD_TOKEN`. |
| Slash commands don't appear | Run `npm run register`. Without `GUILD_ID`, wait up to an hour. Make sure the bot was invited with the link above (it includes `applications.commands`). |
| Every command shows up twice | You registered both server-only and global. Run `npm run register -- --clear-guild`. |
| "I'm missing a permission…" or "higher than my highest role" | Re-invite with the link above, or drag the bot's role higher in **Server Settings > Roles**. |
| Transcripts say "(no text)" | Turn on **Message Content Intent** on the Bot page. |
| "The meme machine is taking a nap" | meme-api.com is down or slow. It usually fixes itself. Other commands keep working. |
| "This command no longer exists" | Run `npm run register` again after an update. |

The bot logs problems to the console (`pm2 logs`, `journalctl` or `docker logs`). One failing command never takes the bot down.

## Customizing

- **Trivia questions:** `src/lib/triviaQuestions.js`. Each question needs one `answer` and three `wrong` answers. `npm test` checks they're well formed.
- **Coins and memes:** the `.env` settings above.
- **New command:** add a file to `src/commands/` (copy `ping.js` as a starting point), list it in `src/commands/index.js`, run `npm test`, then `npm run register`.

## How the code is organised

```
src/
  index.js           start here (npm start)
  bot.js             Discord client, intents, events, shutdown
  register.js        registers slash commands (npm run register)
  interactions.js    routes commands and buttons; turns errors into friendly replies
  config.js, db.js   .env settings and the SQLite database
  commands/          one file per slash command
  features/          tickets, reaction roles, welcome, trivia, moderation helpers, logging
  lib/               plain logic with no Discord connection (tested in test/)
test/                npm test (Node's built-in test runner)
```
