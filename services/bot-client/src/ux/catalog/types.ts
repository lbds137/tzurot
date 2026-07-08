/**
 * Message-catalog types — the platform-neutral intent layer.
 *
 * PORTABILITY BOUNDARY (depcruise-enforced): nothing under `ux/catalog/` may
 * import discord.js. Specs carry semantic tokens (severity, outcome, icon);
 * the Discord renderer (`ux/render/`) owns glyphs, markdown affordances, and
 * ack-state plumbing. Discord-flavored *strings* (mentions, `<t:…>`) are fine
 * in spec text — the boundary is imports/types, not markup (design §4.6).
 */

/** Visual class of the message — drives the renderer's emoji prefix. */
export type MessageSeverity = 'error' | 'warning' | 'success' | 'info' | 'progress';

/**
 * Outcome-honesty class — drives (and constrains) the retry affordance.
 *
 * - `failed`: the operation definitively did not happen; retry is honest.
 * - `uncertain`: the write MAY have applied (timeout/network mid-flight);
 *   text must never invite a blind retry (duplicate-write risk).
 * - `committed-unconfirmed`: the write applied but confirmation couldn't be
 *   read back; text must steer to verify, not re-save.
 * - `ok`: success.
 * - `none`: informational — no operation outcome involved.
 */
export type MessageOutcome = 'failed' | 'uncertain' | 'committed-unconfirmed' | 'ok' | 'none';

/**
 * Semantic icon token for the few intents whose glyph is not derivable from
 * severity (session expiry, in-flight loading). Derived from MessageSeverity
 * so a severity rename can't silently desync the two. Renderer-mapped; the
 * catalog never contains glyphs itself.
 */
export type MessageIcon = MessageSeverity | 'session-expiry' | 'loading';

export interface MessageSpec {
  severity: MessageSeverity;
  outcome: MessageOutcome;
  /** System-register rendered text, pre-emoji. */
  text: string;
  /**
   * Persona-register rendering for persona-eligible intents (capacity /
   * capability limits delivered in-character). Absent = system-voice only;
   * the renderer must never speak persona-flavored text through the bot
   * account (design §4.2 voice axis).
   */
  personaText?: string;
  /** Icon override when severity's default glyph is wrong (see MessageIcon). */
  icon?: MessageIcon;
}
