import test from "node:test";
import assert from "node:assert/strict";
import { formatTranscript } from "../src/lib/transcript.js";
import { ticketChannelName } from "../src/features/tickets.js";

const base = { ticketId: 7, guildName: "Blocky", channelName: "ticket-0007-steve", openedBy: "steve", closedBy: "mod" };
const t = Date.UTC(2026, 9, 15, 14, 3, 22);

test("transcript has a header and messages oldest first", () => {
  const text = formatTranscript({
    ...base,
    messages: [
      { createdAt: t + 60_000, author: "mod", bot: false, content: "How can we help?", attachments: [], embeds: 0 },
      { createdAt: t, author: "steve", bot: false, content: "Hi!", attachments: [], embeds: 0 },
    ],
  });
  const lines = text.split("\n");
  assert.equal(lines[0], "Ticket #7 (#ticket-0007-steve)");
  assert.ok(text.includes("Server: Blocky"));
  assert.ok(text.includes("Messages: 2"));
  assert.ok(text.indexOf("Hi!") < text.indexOf("How can we help?"));
  assert.ok(text.includes("[2026-10-15 14:03:22 UTC] steve: Hi!"));
  assert.ok(text.endsWith("\n"));
  assert.ok(!text.includes("Message Content Intent"));
});

test("attachments, embeds and multi-line messages are kept readable", () => {
  const text = formatTranscript({
    ...base,
    messages: [
      { createdAt: t, author: "steve", bot: false, content: "line one\nline two", attachments: ["https://cdn/x.png"], embeds: 0 },
      { createdAt: t + 1, author: "Bot", bot: true, content: "", attachments: [], embeds: 2 },
    ],
  });
  assert.ok(text.includes("steve: line one\n    line two\n    [attachment] https://cdn/x.png"));
  assert.ok(text.includes("Bot: [2 embeds]"));
});

test("warns about the Message Content Intent when member messages come back empty", () => {
  const text = formatTranscript({
    ...base,
    messages: [{ createdAt: t, author: "steve", bot: false, content: "", attachments: [], embeds: 0 }],
  });
  assert.ok(text.includes("steve: (no text)"));
  assert.ok(text.includes("Message Content Intent"));
});

test("ticket channel names are safe and numbered", () => {
  assert.equal(ticketChannelName(7, "Steve"), "ticket-0007-steve");
  assert.equal(ticketChannelName(12345, "x__Cool.Dude__x"), "ticket-12345-x-cool-dude-x");
  assert.equal(ticketChannelName(1, "★★★"), "ticket-0001-user");
  assert.ok(ticketChannelName(1, "a".repeat(50)).length <= 32);
});
