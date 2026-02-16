/**
 * Deny View Subcommand
 *
 * Direct lookup of denylist entries by Discord user or guild ID.
 * Shows the detail view if a matching entry is found.
 * Bot owner only.
 */

import { createLogger } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { requireBotOwnerContext } from '../../utils/commandContext/index.js';
import { fetchEntries, type DenylistEntryResponse } from './browse.js';
import { showDetailView } from './detail.js';

const logger = createLogger('deny-view');

/** Handle /deny view target [type?] */
export async function handleView(context: DeferredCommandContext): Promise<void> {
  if (!(await requireBotOwnerContext(context))) {
    return;
  }

  const target = context.getOption<string>('target');
  if (target === null || target === undefined || target.trim().length === 0) {
    await context.editReply('\u274C Please provide a Discord user or server ID.');
    return;
  }

  const typeFilter = context.getOption<string>('type') ?? undefined;

  const entries = await fetchEntries(context.user.id);
  if (entries === null) {
    await context.editReply('\u274C Failed to fetch denylist entries.');
    return;
  }

  // Find matching entries by Discord ID, optionally filtered by type
  const matches = entries.filter(
    (e: DenylistEntryResponse) =>
      e.discordId === target.trim() &&
      (typeFilter === undefined || e.type === typeFilter.toUpperCase())
  );

  if (matches.length === 0) {
    const typeNote = typeFilter !== undefined ? ` (type: ${typeFilter.toUpperCase()})` : '';
    await context.editReply(`No denylist entries found for \`${target.trim()}\`${typeNote}.`);
    return;
  }

  if (matches.length === 1) {
    // Single match — show detail view directly
    await showDetailView(context.interaction, matches[0], {
      page: 0,
      filter: 'all',
      sort: 'date',
    });
    return;
  }

  // Multiple matches — show the first match's detail view
  logger.debug(
    { target, matchCount: matches.length },
    '[Deny] Multiple entries found, showing first'
  );

  await showDetailView(context.interaction, matches[0], {
    page: 0,
    filter: 'all',
    sort: 'date',
  });
}
