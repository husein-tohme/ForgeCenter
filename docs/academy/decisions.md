# Decisions

Choices made while building, with the reason, so later sessions don't undo them by accident. The owner can change any of them.

## 1. Name: CodeHub

Chosen by the owner. Before launch, check that a matching domain is available and that no other coding product in the same countries already uses the name as a trademark; "CodeHub" is a common name, so a longer domain (for example with "learn" or "forge" in it) may be needed.

## 2. Built inside ForgeCenter, at `/learn`

As recommended in the [roadmap](06-roadmap.md): sign-in, the AI mentor, Stripe, support, reports and bot hosting already exist there.

## 3. First videos: suggested by Claude, approved by the owner

The first 20–30 beginner videos (Python, websites, Discord bots) are picked from well-known coding channels and listed for the owner to approve before the lessons go live.

## 4. Student Discord bots at launch: no student code runs on ForgeCenter's server

**What was checked (build step 1):** ForgeCenter's bot runner (`src/botrunner.js`) starts each paid bot as a child process on the same server as the website. It's safe for what it does today, because the code it runs is always ForgeCenter's own template (`templates/discord-bot`); customers only supply a token and settings, and the bot gets a minimal set of environment variables.

**Why that's not enough for code students write:** a child process runs as the same user on the same machine. Code written by a student could read the website's database file, other bots' data, and the website's own secrets (for example through `/proc`, which shows a parent process's environment to the same user). Limiting environment variables doesn't stop that.

**So at launch, students get bots three safe ways:**

| Way | How it works | Runs on |
|---|---|---|
| **Discord simulator** | Students write real bot code in the browser and test it against a pretend Discord server on the page: send messages and slash commands, see the bot reply | The student's browser |
| **Template bot, hosted** | Students build a bot by choosing commands, replies and features in the lesson, stored as settings. ForgeCenter's own template runs it, using the existing bot runner | ForgeCenter, safely, because the code is ours |
| **Deploy it yourself** | A lesson walks students through hosting their own code on a free host under their own account | The student's own account elsewhere |

Hosting **students' own code** on ForgeCenter waits for the micro-VM sandboxes in [Block 3](04-block3-sandboxes.md) (Phase 4). If it's wanted sooner, a hosted micro-VM service (for example Fly Machines, which run on Firecracker) can be used, once paying for it is possible.

Never change the bot runner to run student-written code.

## 5. The launch code viewer is a plain line list, not CodeMirror

Block 2 planned CodeMirror 6 for big files. Launch lesson files are small (each under 90,000 characters), so the lesson page draws them as a simple numbered list with no library to load, which keeps the page light on slow connections. CodeMirror arrives with the playground (build step 7), where students type code.

## 6. Only lesson pages allow YouTube's player

The site's content security policy normally blocks outside scripts and frames. `/learn/lesson` alone adds YouTube's player script (`www.youtube.com`) and its frames (`www.youtube-nocookie.com`, which doesn't set tracking cookies before someone presses play). Every other page keeps the stricter policy.

