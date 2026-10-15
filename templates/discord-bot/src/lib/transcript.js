// Turns a ticket's messages into a plain-text transcript.

function timestamp(ms) {
  return `${new Date(ms).toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

/**
 * messages: [{ createdAt (ms), author (string), bot (bool), content, attachments: [url], embeds (count) }]
 * Messages can be given in any order; they are printed oldest first.
 */
export function formatTranscript({ ticketId, guildName, channelName, openedBy, closedBy, messages }) {
  const lines = [
    `Ticket #${ticketId} (#${channelName})`,
    `Server: ${guildName}`,
    `Opened by: ${openedBy}`,
    `Closed by: ${closedBy}`,
    `Messages: ${messages.length}`,
    "-".repeat(60),
  ];

  let looksEmpty = false;
  for (const m of [...messages].sort((a, b) => a.createdAt - b.createdAt)) {
    const parts = [];
    if (m.content) parts.push(m.content);
    for (const url of m.attachments ?? []) parts.push(`[attachment] ${url}`);
    if (m.embeds) parts.push(`[${m.embeds} embed${m.embeds === 1 ? "" : "s"}]`);
    if (!parts.length) {
      parts.push("(no text)");
      if (!m.bot) looksEmpty = true;
    }
    lines.push(`[${timestamp(m.createdAt)}] ${m.author}: ${parts.join("\n").replace(/\n/g, "\n    ")}`);
  }

  if (looksEmpty) {
    lines.push(
      "",
      'Note: some messages have no text. If that looks wrong, turn on "Message Content Intent"',
      "for this bot in the Discord Developer Portal (Bot page).",
    );
  }
  return `${lines.join("\n")}\n`;
}
