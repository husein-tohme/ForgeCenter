# 4, Block 2. The learning screen

How the video, the code, the map, the docs and the AI tutor share one screen without overwhelming anyone, on a phone or a 4K monitor, for a codebase of any size.

## The rule: one thing in focus

The screen never shows everything at once. It has three **modes**, and each puts one thing in front:

| Mode | In front | Beside it |
|---|---|---|
| **Watch** (default) | The video | The few lines of code it's explaining, the "next" button |
| **Code** | The code viewer, or the student's own editor | The video shrinks to a corner (picture-in-picture) |
| **Explore** | The map | The code of whatever node is selected |

Docs and the AI tutor open as a side panel in any mode. Switching modes is one tap or one key (`1`, `2`, `3`).

### What each level sees by default

| Level | Default screen |
|---|---|
| Just started | Watch mode only: video, a short code snippet, a big "next" button. The map and file tree stay hidden until they finish a few lessons. |
| Hobby coder | Watch mode, with Code mode and the small map one tap away |
| Professional | All three modes, the file tree and keyboard shortcuts shown |

Anyone can turn things on or off in settings. Focus mode hides everything except the lesson.

## Layout by screen size

| Screen | Layout |
|---|---|
| Phone | One pane at a time, with tabs along the bottom: Video, Code, Map, Docs, Tutor. The video sticks to the top while scrolling code. |
| Tablet and laptop | Two panes: the front pane and one beside it |
| Big and 4K screens | Three columns: video, code and map or docs. Text and icons stay sharp (SVG, no images of text). |

Arabic and other right-to-left languages flip the layout, but code always stays left-to-right.

## The code viewer (any size codebase)

The codebase may grow to millions of lines, so the browser never loads it all:

- **Only the visible lines are drawn.** The viewer is built on **CodeMirror 6**, which draws only what's on screen, works on phones, and loads as plain ES modules (no build step, like ForgeCenter).
- **The file tree loads one folder at a time**, when it's opened.
- **Files are fetched on demand** by their content hash, so they're cached forever by the browser and a CDN.
- **Syntax colouring runs in a background worker**, so scrolling never stutters.
- **Spotlight view:** a lesson opens on the exact lines the video explains, with the rest of the file folded away ("show 40 lines above"). Beginners rarely need to see more.
- **Gutter markers:** lines that have a video clip get a small play icon. Hovering shows the clip's title; clicking jumps the video there.

## Syncing the video and the code

1. When a lesson opens, the page fetches **all of that video's links at once**, as one small file: each link is a time range plus file and lines.
2. The YouTube player (or the site's own player for uploads) reports the current time about four times a second.
3. The page looks up which link covers that moment, using the list already loaded, with no request to the server, and highlights those lines.
4. **The other way round:** clicking a play icon in the code jumps the video to that moment.
5. Links below the confidence bar are never shown. Links people reviewed show a small "checked" mark.

With nothing fetched during playback, syncing stays instant even on slow internet.

## The map

A map of a whole codebase is an unreadable tangle, so the map only ever shows **what's near you**:

| Zoom | What it shows |
|---|---|
| Track map | The concepts in your track, what you've done and what unlocks next |
| Project map | The main parts of the project (folders and modules) and how they connect |
| Code map | The function you're on and what it calls and what calls it, one step out |

- At most about 15 nodes at once. More are grouped ("12 more helpers") and open on tap.
- Layouts are worked out on the server ahead of time and cached, so the map appears instantly.
- Drawn as SVG normally. Explore mode switches to canvas (Sigma.js) for big views, so it stays smooth.
- Every node uses the same shapes and colours in every language (below).

## The Context Switcher

Students moving from HTML to C++ to Assembly to SQL keep one mental picture, because every language is drawn with the **same visual language**:

| Idea | Always drawn as |
|---|---|
| A function | A rounded box |
| A loop | A box with a circular arrow |
| A decision (if) | A diamond |
| Data in memory | Stacked boxes (the stack) and loose boxes (the heap) |
| A web request | An arrow between two machines |
| A database table | A grid |

How it works:

- **Side by side:** pick a concept ("loops") and see it in up to three languages at once, from the `concept_idioms` table in Block 1.
- **Lines that mean the same thing are linked.** Hover line 3 in Python and the matching lines light up in C++ and in Assembly.
- **One "what the computer is doing" panel** for every language: variables, the stack, the heap, and for Assembly, the registers. Students step through code line by line and watch it change. The code runs in the sandbox (Block 3).
- **Speed comparison:** run the same program in each language and see how fast each one is, with a plain explanation of why.

## The starting quiz

Five questions, under a minute:

1. What do you want to build? (Games, websites, bots, apps, AI, Minecraft, Roblox, hacking and security, "not sure")
2. Have you coded before? (Never, a little, a lot, it's my job)
3. How much time a day? (10 minutes, 30, an hour, more)
4. What device do you use most? (Phone, laptop, both)
5. Which language should lessons be in?

The answer picks a level, a first track and a daily goal. The path shows right away, and students can retake the quiz or change their path any time.

## Docs pages

- Same layout as lessons: the doc in front, with the matching video and code a tap away.
- Tabs for **Beginner, Hobby and Pro** versions of the same explanation.
- Every code example has a **Run** button (playground, Block 3).
- Hover any word or code for a quick "explain this" from the AI.
- Each doc shows which version of the language it covers.

## The AI tutor panel

- Knows **where you are**: the lesson, the video moment, the code on screen, your own code and your last error. Students don't have to explain or paste anything.
- Buttons for the common asks: "Explain this", "Why doesn't my code work?", "Explain it simpler", "Give me a hint".
- **Homework-safe mode** gives hints and questions, not full answers. Teachers can force it on for their classes.
- Shows the daily AI limit left ("12 questions left today").
- Answers can be read aloud, and students can ask out loud.
- Code the tutor suggests is shown as a change to your code, so you see exactly what it did and why.

## Speed targets

| Target | Goal |
|---|---|
| A lesson page on a mid-range phone on slow 3G | Usable in under 3 seconds |
| JavaScript before the lesson works | Under 200 KB |
| Map, editor and tutor | Loaded only when opened |
| Video-to-code highlight | Instant, nothing fetched during playback |

The transcript and lesson text load first, so students can start reading even before the video is ready.

## Accessibility

- Every action has a keyboard shortcut, and `?` lists them.
- Captions on all videos, and transcripts on the page.
- Screen readers announce the highlighted lines as the video moves.
- Reduced-motion setting; nothing flashes.
- Dyslexia-friendly font option, adjustable text size, and both colour themes meet contrast rules.

## Risks for Block 2

| Risk | What we do |
|---|---|
| Too much on screen scares beginners away | Modes, level defaults, hidden extras, and testing with real beginners before launch |
| Huge files freeze the browser | Draw only visible lines, colour in a worker, fold everything outside the spotlight |
| The map becomes a tangle | Never more than about 15 nodes; only show what's near you |
| The YouTube player behaves differently on some phones | Fall back to simple time polling; test on cheap Android phones |
| Wrong code highlighted at the wrong moment | Only show links above the confidence bar; "report a wrong highlight" button feeds the review queue |
| The AI tutor costs too much | Daily limits, short answers by default, cache common answers for each lesson |
