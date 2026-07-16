/**
 * Release-DM footer + extended-context exclusion.
 *
 * The footer serves two jobs: it steers recipients to the explicit opt-out
 * invocation (spam-report mitigation), and it doubles as the marker by which
 * extended-context fetching recognizes a release DM. Release DMs are
 * bot-authored notifications, not conversation — without the exclusion they
 * classify as relay-echoes (bot-authored, not in the personality registry)
 * and enter DM persona context as user-role content, so personas would treat
 * the release notes as something the user said.
 */

import type { Message } from 'discord.js';

export const OPT_OUT_FOOTER = '\n\n-# Opt out of release DMs anytime with /notifications disable';

/**
 * The match is on the footer's subtext line itself (sans leading newlines):
 * bot-controlled, distinctive, and present on every release DM by
 * construction. Author check first so a user quoting the footer text is
 * never filtered.
 */
const FOOTER_MARKER = OPT_OUT_FOOTER.trimStart();

export function isReleaseNotesDm(msg: Message, botUserId: string): boolean {
  return msg.author.id === botUserId && msg.content.includes(FOOTER_MARKER);
}
