/**
 * Retention notice copy — both grace-cycle notices — + extended-context
 * exclusion (Phase 3, plus the Phase-3-reminder second notice).
 *
 * The footer doubles as the marker by which extended-context fetching
 * recognizes a retention notice — same mechanism as the release DM's
 * OPT_OUT_FOOTER: bot-authored notifications are not conversation, and
 * without the exclusion a persona would ingest the deletion warning as
 * something the user said. Shared by BOTH notices (the warning and the
 * reminder), so `isRetentionNoticeDm` needs no change to recognize either.
 *
 * Deliberate policy properties of this copy (owner-reviewed wording):
 *   - It states the CONCRETE deletion date, rendered as a Discord timestamp
 *     so it localizes to the reader. The warning anchors the date on its own
 *     send time; the reminder re-quotes the SAME date, anchored on the
 *     warning's send time (not "now") — both notices must name one deadline.
 *   - It never carries an export LINK — export links expire in 24h and this
 *     notice may sit unread for weeks; it points at the self-serve command.
 *   - It is NOT gated on notification opt-in (a data-rights notice, not
 *     marketing) and offers no opt-out — the "opt-out" is using the bot once,
 *     or deleting the account now.
 */

import type { Message } from 'discord.js';
import { RETENTION_POLICY } from '@tzurot/common-types/constants/retention';

/**
 * Distinctive, bot-controlled, present on every retention notice by
 * construction — the exclusion marker (see isRetentionNoticeDm).
 */
export const RETENTION_NOTICE_FOOTER =
  '\n\n-# This is an automated data-retention notice. Using the bot once keeps your account.';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Render a Discord date-only timestamp tag for a deletion deadline. */
function deadlineTag(date: Date): string {
  return `<t:${String(Math.floor(date.getTime() / 1000))}:D>`;
}

/**
 * The three self-serve options — identical wording in both notices, so the
 * two builders can never drift on what the user is told to do.
 */
const OPTION_BULLETS =
  '• **To keep everything** — use the bot once. Any command or chat message resets your ' +
  'inactivity clock entirely.\n' +
  '• **To take a copy first** — run `/settings data export` for a full export (download link ' +
  'valid 24 hours).\n' +
  '• **To delete now instead of waiting** — run `/settings data delete`.';

/**
 * The character-reachability paragraph — identical wording in both notices,
 * so the two builders can never drift on what happens to owned characters.
 */
const CHARACTER_PARAGRAPH =
  'A character you created that other people have talked to is not deleted — it is moved to a ' +
  'holding account so their conversations survive, and it can be returned to you if you come back.';

/** Compose the warning DM. `sentAt` anchors the grace deadline (send time). */
export function buildRetentionNotice(sentAt: Date): string {
  const deadline = new Date(sentAt.getTime() + RETENTION_POLICY.GRACE_PERIOD_DAYS * DAY_MS);

  return (
    '**Your data is scheduled for deletion.**\n\n' +
    `This account has not used the bot in over ${String(RETENTION_POLICY.WINDOW_DAYS)} days. ` +
    'Under the data-retention policy, inactive accounts are erased: conversations, memories, ' +
    'characters, personas, and settings.\n\n' +
    `**Deletion date: on or after ${deadlineTag(deadline)}** ` +
    `(${String(RETENTION_POLICY.GRACE_PERIOD_DAYS)} days from this notice).\n\n` +
    `${OPTION_BULLETS}\n\n` +
    CHARACTER_PARAGRAPH
  );
}

/**
 * Compose the reminder DM. `notifiedAt` is the WARNING's send time, which
 * anchors the deadline both notices quote; `sentAt` is this reminder's own
 * send time. The reminder window runs from day 23 to day 29 of the warning's
 * age, so the headline's day count is derived from the actual remaining time
 * (deadline minus `sentAt`) rather than the `REMINDER_LEAD_DAYS` constant —
 * both notices still quote the one deadline.
 */
export function buildRetentionReminder(notifiedAt: Date, sentAt: Date): string {
  const deadline = new Date(notifiedAt.getTime() + RETENTION_POLICY.GRACE_PERIOD_DAYS * DAY_MS);
  const daysLeft = Math.max(1, Math.ceil((deadline.getTime() - sentAt.getTime()) / DAY_MS));

  return (
    `**Reminder: your data is scheduled for deletion in about ${String(daysLeft)} day${daysLeft === 1 ? '' : 's'}.**\n\n` +
    'This is the second and last notice. ' +
    `This account has not used the bot in over ${String(RETENTION_POLICY.WINDOW_DAYS)} days, and ` +
    'under the data-retention policy inactive accounts are erased: conversations, memories, ' +
    'characters, personas, and settings.\n\n' +
    `**Deletion date: on or after ${deadlineTag(deadline)}** (the same date as the first notice).\n\n` +
    `${OPTION_BULLETS}\n\n` +
    CHARACTER_PARAGRAPH
  );
}

/**
 * Author check first so a user quoting the footer text is never filtered —
 * mirrors isReleaseNotesDm. Needs no per-notice branching: both the warning
 * and the reminder append the SAME `RETENTION_NOTICE_FOOTER`, so this
 * recognizes either notice unchanged.
 */
const FOOTER_MARKER = RETENTION_NOTICE_FOOTER.trimStart();

export function isRetentionNoticeDm(msg: Message, botUserId: string): boolean {
  return msg.author.id === botUserId && msg.content.includes(FOOTER_MARKER);
}
