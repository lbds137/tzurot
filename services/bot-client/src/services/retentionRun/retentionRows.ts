/**
 * The one definition of the per-user row format shared by every retention
 * job surface — the live-run report, the report-only nag, and the rehearsal
 * embed all render the same line shape so an operator reading any of the
 * three recognizes the others.
 */

import { escapeMarkdown } from 'discord.js';
import type { RetentionPreviewUser } from './types.js';

/** Embed line cap — the full cohort belongs to the preview CLI, not Discord. */
export const MAX_LISTED_USERS = 10;

export const RETENTION_REASON_LABELS = {
  account_gone: 'account deleted',
  unreachable: 'unreachable',
  grace_expired: 'grace expired',
  bystander: 'never used directly',
} as const;

/**
 * Render up to `MAX_LISTED_USERS` rows, one line per user, capped with an
 * overflow line naming how many more were left out.
 *
 * Three identity tokens per line, deliberately redundant: the `<@id>` mention
 * frequently fails to resolve on mobile, the plain-text username is the
 * readable fallback, and the backticked id is the copy-paste handle the CLI
 * commands take. The username is user-controlled text entering an
 * owner-facing embed, so it is escaped; an empty one drops its token rather
 * than rendering a dangling `@`.
 */
export function formatRetentionUserLines(
  users: readonly RetentionPreviewUser[],
  overflowNote?: string
): string[] {
  const lines = users.slice(0, MAX_LISTED_USERS).map(user => {
    const escapedUsername = escapeMarkdown(user.username);
    const usernameToken = user.username.trim() === '' ? '' : `@${escapedUsername} `;
    return (
      `<@${user.discordId}> ${usernameToken}— \`${user.discordId}\` — ` +
      `inactive since ${user.inactiveSince.slice(0, 10)} ` +
      `(${RETENTION_REASON_LABELS[user.reason]})`
    );
  });
  if (users.length > MAX_LISTED_USERS) {
    const overflow = `…and ${String(users.length - MAX_LISTED_USERS)} more`;
    lines.push(overflowNote === undefined ? overflow : `${overflow} ${overflowNote}`);
  }
  return lines;
}
