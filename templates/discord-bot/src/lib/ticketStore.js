// Ticket records. Discord-specific work (channels, buttons) lives in features/tickets.js.

const SELECT = `SELECT id, guild_id AS guildId, user_id AS userId, channel_id AS channelId,
  claimed_by AS claimedBy, is_open AS isOpen, created_at AS createdAt FROM tickets`;

const plain = (row) => (row ? { ...row } : null);

export function findOpenTicketByUser(db, guildId, userId) {
  return plain(db.prepare(`${SELECT} WHERE guild_id = ? AND user_id = ? AND is_open = 1`).get(guildId, userId));
}

export function findTicketByChannel(db, channelId) {
  return plain(db.prepare(`${SELECT} WHERE channel_id = ? AND is_open = 1`).get(channelId));
}

/**
 * Reserves a ticket for a user. Returns { ticket } or { existing } if they already have one open.
 * The channel is attached afterwards with setTicketChannel().
 */
export function createTicket(db, { guildId, userId, now = Date.now() }) {
  const existing = findOpenTicketByUser(db, guildId, userId);
  if (existing) return { existing };
  const { lastInsertRowid } = db
    .prepare("INSERT INTO tickets (guild_id, user_id, created_at) VALUES (?, ?, ?)")
    .run(guildId, userId, now);
  return { ticket: { id: Number(lastInsertRowid), guildId, userId, createdAt: now } };
}

export function setTicketChannel(db, ticketId, channelId) {
  db.prepare("UPDATE tickets SET channel_id = ? WHERE id = ?").run(channelId, ticketId);
}

/** Removes a reservation when the channel could not be created. */
export function deleteTicket(db, ticketId) {
  db.prepare("DELETE FROM tickets WHERE id = ?").run(ticketId);
}

/** Returns true if this call claimed it, false if someone already had. */
export function claimTicket(db, ticketId, staffId) {
  const { changes } = db
    .prepare("UPDATE tickets SET claimed_by = ? WHERE id = ? AND claimed_by IS NULL AND is_open = 1")
    .run(staffId, ticketId);
  return Number(changes) === 1;
}

export function closeTicket(db, ticketId, closedBy, now = Date.now()) {
  db.prepare("UPDATE tickets SET is_open = 0, closed_at = ?, closed_by = ? WHERE id = ?").run(
    now,
    closedBy,
    ticketId,
  );
}
