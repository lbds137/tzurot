/**
 * Retention warning-notice copy + extended-context exclusion (Phase 3).
 *
 * The footer doubles as the marker by which extended-context fetching
 * recognizes a retention notice — same mechanism as the release DM's
 * OPT_OUT_FOOTER: bot-authored notifications are not conversation, and
 * without the exclusion a persona would ingest the deletion warning as
 * something the user said.
 *
 * Deliberate policy properties of this copy (owner-reviewed wording):
 *   - It states the CONCRETE deletion date (send time + grace), rendered as a
 *     Discord timestamp so it localizes to the reader.
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

/** Compose the warning DM. `sentAt` anchors the grace deadline (send time). */
export function buildRetentionNotice(sentAt: Date): string {
  const deadline = new Date(sentAt.getTime() + RETENTION_POLICY.GRACE_PERIOD_DAYS * DAY_MS);
  const deadlineTag = `<t:${String(Math.floor(deadline.getTime() / 1000))}:D>`;

  return (
    '**Your data is scheduled for deletion.**\n\n' +
    `This account has not used the bot in over ${String(RETENTION_POLICY.WINDOW_DAYS)} days. ` +
    'Under the data-retention policy, inactive accounts are erased: conversations, memories, ' +
    'characters, personas, and settings.\n\n' +
    `**Deletion date: on or after ${deadlineTag}** ` +
    `(${String(RETENTION_POLICY.GRACE_PERIOD_DAYS)} days from this notice).\n\n` +
    '• **To keep everything** — use the bot once. Any command or chat message resets your ' +
    'inactivity clock entirely.\n' +
    '• **To take a copy first** — run `/settings data export` for a full export (download link ' +
    'valid 24 hours).\n' +
    '• **To delete now instead of waiting** — run `/settings data delete`.\n\n' +
    'A character you created that other people have talked to is not deleted — it is moved to a ' +
    'holding account so their conversations survive, and it can be returned to you if you come back.'
  );
}

/**
 * Author check first so a user quoting the footer text is never filtered —
 * mirrors isReleaseNotesDm.
 */
const FOOTER_MARKER = RETENTION_NOTICE_FOOTER.trimStart();

export function isRetentionNoticeDm(msg: Message, botUserId: string): boolean {
  return msg.author.id === botUserId && msg.content.includes(FOOTER_MARKER);
}
