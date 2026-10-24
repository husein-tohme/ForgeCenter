# 4, Block 3. Sandboxes

Students run code all the time: playground snippets, Discord bots that stay online, hacking labs, their own operating systems. All of it is untrusted code from strangers, so it must never be able to reach CodeHub's servers, its database, other students, or anything on the internet it shouldn't.

## The two rules

1. **Run it in the student's browser whenever possible.** It's free, instant, works offline, and can't touch our servers at all.
2. **When it must run on our servers, run it inside a micro virtual machine** (a tiny, separate computer) with no secrets, strict limits and almost no network. Plain Docker containers are not enough for code from strangers.

## What runs where

| Workload | Where it runs | How long |
|---|---|---|
| Playground: JavaScript, TypeScript, HTML, CSS | Browser | Seconds |
| Playground: Python (Pyodide), SQL (SQLite in WebAssembly), Ruby (ruby.wasm), PHP (php-wasm), R (webR), Lua, Scratch | Browser | Seconds |
| Playground: everything else (C, C++, Rust, Go, Java, C#, Kotlin, Swift, Haskell, Elixir, F# and the rest) | Server sandbox | Seconds |
| "What the computer is doing" step-through (Block 2) | Browser where possible, server sandbox otherwise | Seconds |
| Discord bots and other always-on projects | Server sandbox | Hours to always on |
| Student websites | Static files on a CDN; apps with a server use the bot sandbox | Always on |
| Hacking labs | A private network of sandboxes per student | Up to 2 hours |
| OS lessons | Built in a server sandbox, run in an emulator in the browser | Minutes |
| Minecraft server track | Real servers through ForgeCenter's hosting (Pterodactyl) | A lesson, or a paid plan |
| GPU track | Short demos and cloud credits, never free GPU time | Minutes |

At launch (Python, websites, Discord bots), no server sandboxes are needed at all: the playground and the Discord simulator run in the browser, and hosted bots are template bots built from settings ([decision 4](decisions.md#4-student-discord-bots-at-launch-no-student-code-runs-on-forgecenters-server)).

## The sandbox technology

| Option | Verdict |
|---|---|
| Plain Docker | Not safe enough: every container shares the server's kernel, so one kernel bug lets code escape |
| gVisor | Good for short playground runs: a fake kernel between the code and the real one, and cheap to start |
| **Firecracker micro-VMs** | **The main choice.** Each sandbox is a real tiny virtual machine (what AWS Lambda uses). Starts in well under a second and uses little memory |

- Server-side playground runs use **gVisor** or Firecracker, from a **warm pool** of ready sandboxes, so runs start instantly.
- Bots, websites with a server, labs and OS builds use **Firecracker**.
- Firecracker needs servers that allow virtualisation: bare-metal or "metal" cloud servers (dedicated servers at providers like Hetzner, or AWS metal instances). Most normal cloud servers don't allow it, so this decides where it's hosted.
- Run through Kubernetes with Kata Containers or firecracker-containerd, on their own servers, in **a separate cloud account** from the main site.

## Security layers (every sandbox)

1. **Its own virtual machine**, so a crash or attack stays inside it.
2. **No secrets of ours inside.** The sandbox gets only the student's own code and settings, the same rule ForgeCenter's `botrunner.js` follows.
3. **Strict limits:** CPU, memory, disk, number of processes, run time and output size.
4. **Read-only system files**, running as a normal user, never as admin.
5. **Network blocked by default.** Each workload only reaches what it needs (below). The cloud's internal addresses (like `169.254.169.254`) and CodeHub's own servers are always blocked.
6. **Separate network and cloud account**, so even a full escape lands somewhere with nothing valuable.
7. **Abuse detection:** crypto mining, network scanning, spam and DDoS patterns get the sandbox stopped automatically and flagged for a moderator.
8. **A kill switch** for the owner and admins: stop one sandbox, one student's sandboxes, or all of them.
9. **Logs** of every start, stop and block, kept for moderators.

## The playground

| Limit | Value |
|---|---|
| Run time | 10 seconds (free), 30 seconds (paid) |
| Memory | 256 MB |
| Network | None |
| Output shown | First 64 KB |
| Files | A temporary folder, wiped after the run |

- Students can send keyboard input to their program.
- Compilers and libraries are already installed in the sandbox image, so runs don't download anything.
- Server runs are counted per day, like the AI limit; browser runs are unlimited.

## Discord bot hosting

### Life of a bot

1. **Create:** pick a template (JavaScript, Python or Rust) or start empty.
2. **Code** in the browser editor, with the AI tutor beside it.
3. **Add the bot token.** It's encrypted with the site's secret key, never shown again, never logged, and only placed in that bot's own sandbox.
4. **Build:** packages install through our own package cache (npm, PyPI, crates.io), never straight from the internet.
5. **Run:** live logs stream to the page.
6. **Stop, restart, update** at any time.
7. **Sleep:** free bots stop when idle and wake when the student comes back.
8. **Delete:** the sandbox, its files and the token are wiped.

A bot that keeps crashing waits longer between each restart, and the student is shown the error with an "Ask the tutor" button.

### Limits

| Plan | Bot runs | Size |
|---|---|---|
| Free | While you're working on it, up to 2 hours a day | Tiny (a quarter of a CPU, 256 MB) |
| Paid | Always on, 1 bot | Tiny |
| More bots | Hosting from ForgeCenter's shop | Bigger |

### Network

- Allowed: Discord's API and gateway, and the package cache during builds.
- Students can ask for extra sites their bot needs (for example a weather API). They're added to that bot's own allowlist after an automatic check.
- Everything else is blocked.

### Following Discord's rules

- **Only bot tokens are accepted.** The token is checked with Discord when added; user account tokens ("selfbots") break Discord's rules and are refused.
- Code that steals tokens, spams or raids servers gets the bot stopped and reported.
- The rules page explains this before a student hosts anything.

## Student websites

- **Websites without a server** (HTML, CSS, JavaScript) are published as static files to storage and a CDN, at an address like `name.<codehub-sites domain>`.
- **That domain is separate from CodeHub's own domain**, so a student's JavaScript can never read CodeHub sign-in cookies or act as another user.
- **Websites with a server** (PHP, Python, Node and so on) run in a bot-style sandbox, with web traffic coming in through a gateway.
- Every site gets HTTPS, size limits, and a report button. Phishing and fake login pages are taken down and the account suspended.

## Hacking labs

- **Each student gets a private lab:** an attacker machine plus one or more deliberately weak target machines, joined by a private network.
- **No internet at all.** Labs can only reach machines in the same lab, so nothing learned there can be pointed at a real site from our servers.
- **Labs end automatically** after 2 hours, and can be restarted fresh.
- **CTF flags** prove a challenge is solved and feed XP and certificates.
- Targets are built in-house or from open-source training apps whose licences allow it, like OWASP Juice Shop and DVWA.
- **Before the first lab:** students read and accept the rules (only hack inside the labs; never real sites without written permission).
- **Advanced attack labs** are for older or verified students. Teachers can turn labs on or off for their classes.

## OS lessons

- The student's kernel is **built in a server sandbox** (C, Assembly and Rust compilers, plus the tools that make a bootable image).
- The bootable image then **runs in an emulator in the browser** (v86, which emulates an x86 PC in WebAssembly), so testing costs nothing and can't break anything.
- For 64-bit and later lessons the browser emulator may not be enough; those run in **QEMU in a server sandbox**, with the screen streamed to the page.
- Each step has automatic checks ("does it print to the screen?", "does the keyboard work?").

## Minecraft server track

- Lessons use **short-lived small servers** on ForgeCenter's existing Pterodactyl hosting: up to 1 hour, then deleted.
- Students who want a server that stays online buy ForgeCenter Minecraft hosting.
- The "server from scratch" expert track runs the student's own server code in a Firecracker sandbox. Only Minecraft clients, through a gateway, can connect.

## Costs

- **The browser does most of the work**, which is free: the launch playground needs no servers.
- **Warm pools stay small** and grow with demand.
- **Free plans have daily limits** for server runs, bot hours and labs.
- **Idle sandboxes sleep.**
- The owner's cost dashboard shows sandbox costs next to AI costs.

## Risks for Block 3

| Risk | What we do |
|---|---|
| Someone escapes a sandbox | Micro-VMs, no secrets inside, a separate network and cloud account, quick security updates |
| Our servers are used to attack other sites | Network blocked by default, no internet in labs, abuse detection, kill switch |
| Crypto mining burns money | CPU limits, run-time limits, mining detection, daily limits on free plans |
| Bots break Discord's rules | Bot tokens only, rules page, reports, automatic stops |
| Phishing pages on student websites | A separate domain, reports, quick takedowns, suspensions |
| Servers that allow micro-VMs are harder to find and cost more | Browser-first playground; start with a few dedicated servers; gVisor where it's enough |
| Kids running hacking labs | Rules acceptance, age and teacher controls, labs sealed off from the internet |
