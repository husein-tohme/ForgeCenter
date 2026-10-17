/**
 * An expected problem we want to show to the member as-is (e.g. "Tickets aren't set up yet").
 * Throw it from any command or button handler; the interaction router replies with the
 * message privately and does not log a stack trace.
 */
export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = "UserError";
  }
}
