/**
 * Deny View Subcommand
 *
 * Direct lookup of denylist entries by Discord user or guild ID.
 * Shows the detail view if a matching entry is found.
 * Bot owner only.
 */

import { escapeMarkdown } from 'discord.js';
import { DENYLIST_LIST_MAX_ENTRIES } from '@tzurot/common-types/schemas/api/denylist';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { requireBotOwnerContext } from '../../utils/commandContext/index.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { fetchEntriesResult } from './browse.js';
import type { DenylistEntryResponse } from './browseTypes.js';
import { showDetailView } from './detail.js';
import { formatTypeLabel } from './denyLabels.js';

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

  const { ownerClient } = clientsFor(context.interaction);
  const fetched = await fetchEntriesResult(ownerClient);
  if (!fetched.ok) {
    await context.editReply(
      renderSpec(classifyGatewayFailure(fetched.failure, 'entry', { operation: 'read' }))
    );
    return;
  }
  const entries = fetched.entries;

  // Find matching entries by Discord ID, optionally filtered by type
  const matches = entries.filter(
    (e: DenylistEntryResponse) =>
      e.discordId === target.trim() &&
      (typeFilter === undefined || e.type === typeFilter.toUpperCase())
  );

  if (matches.length === 0) {
    const typeNote = typeFilter !== undefined ? ` (type: ${formatTypeLabel(typeFilter)})` : '';
    if (fetched.truncated) {
      await context.editReply(
        renderSpec(
          CATALOG.error.validation(
            `Couldn't find \`${escapeMarkdown(target.trim())}\` in the newest ${DENYLIST_LIST_MAX_ENTRIES} entries${typeNote} — if it still exists, remove it with /deny remove.`
          )
        )
      );
      return;
    }
    // Below the cap the miss stays the plain historical not-found answer; only
    // the at-cap branch above carries the ruled catalog copy — styles differ on purpose.
    await context.editReply(
      `No denylist entries found for \`${escapeMarkdown(target.trim())}\`${typeNote}.`
    );
    return;
  }

  if (matches.length === 1) {
    // Single match — show detail view directly
    // null browseContext — user didn't come from /deny browse, so delete
    // renders a clean terminal (no fabricated "back to browse" rebuild).
    await showDetailView(context.interaction, matches[0], null);
    return;
  }

  // Multiple matches — show the first match's detail view with a note
  logger.debug({ target, matchCount: matches.length }, 'Multiple entries found, showing first');

  await showDetailView(
    context.interaction,
    matches[0],
    null,
    `Found ${matches.length} entries for \`${target.trim()}\`. Showing first match — use the type filter for a specific entry.`
  );
}
