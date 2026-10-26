/**
 * Deny Browse Batch Flow ("Select several")
 *
 * Multi-select batch removal for `/deny browse` (bot owner only):
 * - `deny::batch-select::<page>::<filter>::<sort>` button swaps the current
 *   page into multi-select mode (select + Cancel, no pagination/filter/sort row).
 * - `deny::batch-select::<page>::<filter>::<sort>` menu submission renders a
 *   single-verb `Remove (N)` confirmation listing every selected entry, with
 *   the picked entry UUIDs encoded in the confirm embed's footer.
 * - `deny::batch-confirm::<page>::<filter>::<sort>` strips components, fetches
 *   the full denylist once via `fetchEntries`, resolves each picked UUID to its
 *   `(type, discordId, scope, scopeId)` removal tuple, runs `removeDenylistEntry`
 *   sequentially with per-item failure isolation, and delivers the outcome
 *   report stacked over a refreshed browse view via `deliverBatchReport`.
 * - `deny::batch-cancel::<page>::<filter>::<sort>` returns to a freshly-fetched
 *   single-select browse view for the same page/filter/sort.
 */

import {
  escapeMarkdown,
  MessageFlags,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { ENTITY_EMOJI } from '@tzurot/common-types/constants/uxVocabulary';
import { DENYLIST_LIST_MAX_ENTRIES } from '@tzurot/common-types/schemas/api/denylist';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import type { OwnerClient } from '@tzurot/clients';
import { clientsFor } from '../../utils/gatewayClients.js';
import { pluralize } from '../../utils/browse/index.js';
import { truncateForSelect } from '../../utils/browse/truncation.js';
import {
  batchResultColor,
  buildBatchConfirmView,
  buildBatchResultEmbed,
  clampBatchConfirmDescription,
  deliverBatchReport,
  encodeBatchFooterIds,
  formatBatchCountsLine,
  formatBatchItemLines,
  formatFallbackIdLabel,
  PAGE_FETCH_FAILED_COPY,
  parseBatchFooterIds,
  readSelectOptionLabels,
  runBatchSequentially,
  toBatchOutcomeLine,
  type BatchItemResult,
  type BatchReportView,
  type BatchResultLine,
} from '../../utils/browse/multiSelectBatch.js';
import { DASHBOARD_MESSAGES } from '../../utils/dashboard/messages.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';
import { ackUpdate } from '../../ux/render/reply.js';
import {
  DENY_BATCH_ACTION,
  buildBrowseResponse,
  buildDenyBatchCustomId,
  fetchEntries,
  formatDenySelectOption,
  parseDenyBatchCustomId,
  type ParsedDenyBatchCustomId,
} from './browse.js';
import type { DenylistEntryResponse } from './browseTypes.js';

const logger = createLogger('deny-browse-batch');

/**
 * Per-item failure note mirroring `detail.ts`'s one-pick delete failure copy
 * (`DASHBOARD_MESSAGES.OPERATION_FAILED('delete entry')`), without the leading
 * glyph because `formatBatchItemLines` prepends `❌`.
 */
export const FAILED_TO_REMOVE_NOTE = 'Failed to delete entry. Please try again.';

const EMPTY_SELECTION_MSG = renderSpec(CATALOG.error.validation('No entries were selected.'));

const MISSING_SELECTION_MSG = renderSpec(
  CATALOG.error.validation('Could not determine which entries were selected. Please try again.')
);

const GENERIC_ERROR_MSG = DASHBOARD_MESSAGES.OPERATION_FAILED('remove denylist entries');

/** Bullet prefix of each listing line in the confirm embed, written at pick and read back at confirm. */
const LISTING_BULLET = '• ';

/** Outcome of one single-entry delete step inside the batch loop. */
type DenyBatchOutcome = 'success' | 'already-gone';

/** Fallback display label when an entry's option label is not available on the message. */
export function fallbackDenyLabel(entryId: string): string {
  return formatFallbackIdLabel(entryId, 'Entry');
}

/** Whether a button customId targets one of the deny batch actions (`batch-select` / `batch-confirm` / `batch-cancel`). */
export function isDenyBatchButton(customId: string): boolean {
  return parseDenyBatchCustomId(customId) !== null;
}

/** Whether a select-menu customId targets the deny batch multi-select (`batch-select`). */
export function isDenyBatchSelect(customId: string): boolean {
  return parseDenyBatchCustomId(customId)?.action === DENY_BATCH_ACTION.SELECT;
}

/**
 * Recover per-id display labels from the confirm embed description's bullet
 * lines (already escaped and bounded by `handleDenyBatchPick`) when they match
 * `entryIds.length`. Falls back to an empty map if the listing was clamped or absent.
 */
function recoverConfirmListingLabels(
  description: string | null | undefined,
  entryIds: readonly string[]
): ReadonlyMap<string, string> {
  if (description === undefined || description === null || description.length === 0) {
    return new Map();
  }
  const lines = (description.split('\n\n')[0] ?? '').split('\n');
  if (lines.length !== entryIds.length || !lines.every(line => line.startsWith(LISTING_BULLET))) {
    return new Map();
  }
  return new Map(
    entryIds.map((entryId, idx) => [entryId, (lines[idx] ?? '').slice(LISTING_BULLET.length)])
  );
}

/**
 * Resolve one picked entry UUID against the pre-fetched denylist and execute
 * `ownerClient.removeDenylistEntry(type, discordId, scope, scopeId)`:
 * - entry absent from an uncapped fetched list → `'already-gone'` (no gateway delete call)
 * - entry absent from a capped fetched list (`listTruncated`) (a list at the cap counts, see listTruncated) → logs `warn({ userId, entryId })` and throws `FAILED_TO_REMOVE_NOTE`
 * - `result.ok` → `'success'`
 * - `result.status === 404` → `'already-gone'`
 * - other `!result.ok` → logs `warn({ userId, entryId, status })` and throws `FAILED_TO_REMOVE_NOTE`
 * - thrown delete call → logs `warn({ err, userId, entryId })` and throws `FAILED_TO_REMOVE_NOTE`
 */
async function runSingleDenyRemoval(
  ownerClient: OwnerClient,
  entriesById: ReadonlyMap<string, DenylistEntryResponse>,
  entryId: string,
  userId: string,
  listTruncated: boolean
): Promise<DenyBatchOutcome> {
  const entry = entriesById.get(entryId);
  if (entry === undefined) {
    if (listTruncated) {
      logger.warn({ userId, entryId }, 'Batch denylist pick absent from a capped re-fetch');
      throw new Error(FAILED_TO_REMOVE_NOTE);
    }
    return 'already-gone';
  }
  let result: Awaited<ReturnType<OwnerClient['removeDenylistEntry']>>;
  try {
    result = await ownerClient.removeDenylistEntry(
      entry.type,
      entry.discordId,
      entry.scope,
      entry.scopeId
    );
  } catch (error) {
    logger.warn({ err: error, userId, entryId }, 'Batch denylist removal item threw');
    throw new Error(FAILED_TO_REMOVE_NOTE, { cause: error });
  }
  if (result.ok) {
    return 'success';
  }
  if (result.status === 404) {
    return 'already-gone';
  }
  logger.warn({ userId, entryId, status: result.status }, 'Batch denylist removal item failed');
  throw new Error(FAILED_TO_REMOVE_NOTE);
}

function resolveDenyBatchLabel(
  entryId: string,
  recoveredLabels: ReadonlyMap<string, string>,
  entriesById: ReadonlyMap<string, DenylistEntryResponse>
): string {
  // Labels recovered from the confirm listing are already escaped and bounded;
  // only the fallback label path escapes.
  const recovered = recoveredLabels.get(entryId);
  if (recovered !== undefined) {
    return recovered;
  }
  const entry = entriesById.get(entryId);
  const rawFallback =
    entry !== undefined ? formatDenySelectOption(entry).label : fallbackDenyLabel(entryId);
  return escapeMarkdown(truncateForSelect(rawFallback, { stripNewlines: true }));
}

function buildDenyBatchResultLines(
  results: readonly BatchItemResult<DenyBatchOutcome>[],
  recoveredLabels: ReadonlyMap<string, string>,
  entriesById: ReadonlyMap<string, DenylistEntryResponse>
): BatchResultLine[] {
  return results.map(item =>
    toBatchOutcomeLine(
      item,
      resolveDenyBatchLabel(item.id, recoveredLabels, entriesById),
      FAILED_TO_REMOVE_NOTE
    )
  );
}

/** Build the refreshed browse view for the batch report stack; returns null on list failure. */
export async function buildRefreshedDenyBrowseView(
  ownerClient: OwnerClient,
  coords: Pick<ParsedDenyBatchCustomId, 'page' | 'filter' | 'sort'>
): Promise<BatchReportView | null> {
  const entries = await fetchEntries(ownerClient);
  if (entries === null) {
    return null;
  }
  return buildBrowseResponse(entries, coords.page, coords.filter, coords.sort);
}

async function refreshDenyBrowseMode(
  interaction: ButtonInteraction,
  coords: ParsedDenyBatchCustomId,
  mode: 'single' | 'batch'
): Promise<void> {
  const userId = interaction.user.id;
  try {
    const { ownerClient } = clientsFor(interaction);
    const entries = await fetchEntries(ownerClient);
    if (entries === null) {
      logger.warn({ userId, mode }, 'Failed to fetch denylist entries for batch browse swap');
      await interaction.followUp({
        content: renderSpec(CATALOG.error.transient(PAGE_FETCH_FAILED_COPY)),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const { embed, components } = buildBrowseResponse(
      entries,
      coords.page,
      coords.filter,
      coords.sort,
      { mode }
    );
    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error({ err: error, userId, mode }, 'Error refreshing deny browse view');
    await interaction
      .followUp({ content: GENERIC_ERROR_MSG, flags: MessageFlags.Ephemeral })
      .catch((followUpError: unknown) => {
        logger.warn({ err: followUpError, userId }, 'Deny batch refresh error followUp failed');
      });
  }
}

/**
 * "Select several" entry button handler — re-fetches denylist entries and swaps
 * the current page into multi-select mode (select + Cancel, no pagination row).
 */
export async function handleDenyBatchSelectEntry(interaction: ButtonInteraction): Promise<void> {
  if (!isBotOwner(interaction.user.id)) {
    return;
  }
  const parsed = parseDenyBatchCustomId(interaction.customId);
  if (parsed?.action !== DENY_BATCH_ACTION.SELECT) {
    return;
  }
  if (!interaction.deferred && !interaction.replied) {
    await ackUpdate(interaction);
  }
  await refreshDenyBrowseMode(interaction, parsed, 'batch');
}

/**
 * Multi-select submission handler — builds the single-verb `Remove (N)` batch
 * confirmation view listing every selected entry and storing the picked entry
 * UUIDs in the confirm embed's footer.
 */
export async function handleDenyBatchPick(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!isBotOwner(interaction.user.id)) {
    return;
  }
  const parsed = parseDenyBatchCustomId(interaction.customId);
  if (parsed?.action !== DENY_BATCH_ACTION.SELECT) {
    return;
  }
  if (!interaction.deferred && !interaction.replied) {
    await ackUpdate(interaction);
  }

  const ids = interaction.values.filter(value => value.length > 0);
  if (ids.length === 0) {
    await interaction.followUp({
      content: EMPTY_SELECTION_MSG,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const labels = readSelectOptionLabels(interaction.message);
  const listing = ids
    .map(id => {
      const known = labels.get(id);
      return `${LISTING_BULLET}${escapeMarkdown(known ?? fallbackDenyLabel(id))}`;
    })
    .join('\n');
  const countNoun = pluralize(ids.length, {
    singular: 'denylist entry',
    plural: 'denylist entries',
  });
  const warning = `**This removes ${countNoun} immediately.** This action cannot be undone.`;

  const { page, filter, sort } = parsed;
  const { embed, components } = buildBatchConfirmView({
    title: `${ENTITY_EMOJI.denial} Remove Denylist Entries?`,
    description: clampBatchConfirmDescription(listing, warning),
    // Entry IDs are UUIDs (newline-free by construction); one pick spans one
    // menu, capped at 25 options by buildBrowseSelectMenu: 25 × 37 chars ≪ 2048,
    // so encodeBatchFooterIds is used directly with no runtime guard.
    footerText: encodeBatchFooterIds(ids),
    confirm: {
      customId: buildDenyBatchCustomId(DENY_BATCH_ACTION.CONFIRM, page, filter, sort),
      label: `Remove (${ids.length})`,
      emoji: '🗑️',
    },
    cancelCustomId: buildDenyBatchCustomId(DENY_BATCH_ACTION.CANCEL, page, filter, sort),
  });

  await interaction.editReply({ embeds: [embed], components });
}

/**
 * Batch cancel button handler (from multi-select mode or the batch confirm
 * view) — returns to a freshly-fetched single-select browse view for the same
 * page/filter/sort without deleting anything.
 */
export async function handleDenyBatchCancel(interaction: ButtonInteraction): Promise<void> {
  if (!isBotOwner(interaction.user.id)) {
    return;
  }
  const parsed = parseDenyBatchCustomId(interaction.customId);
  if (parsed?.action !== DENY_BATCH_ACTION.CANCEL) {
    return;
  }
  if (!interaction.deferred && !interaction.replied) {
    await ackUpdate(interaction);
  }
  await refreshDenyBrowseMode(interaction, parsed, 'single');
}

/**
 * Batch confirm button handler — strips confirm components, fetches the full
 * denylist once to resolve each picked UUID to its `(type, discordId, scope, scopeId)`
 * removal key, executes removals sequentially with per-item failure isolation,
 * and delivers the outcome report stacked over the refreshed browse view.
 */
export async function handleDenyBatchConfirm(interaction: ButtonInteraction): Promise<void> {
  if (!isBotOwner(interaction.user.id)) {
    return;
  }
  const parsed = parseDenyBatchCustomId(interaction.customId);
  if (parsed?.action !== DENY_BATCH_ACTION.CONFIRM) {
    return;
  }
  if (!interaction.deferred && !interaction.replied) {
    await ackUpdate(interaction);
  }

  const userId = interaction.user.id;
  const rawFooter = interaction.message.embeds[0]?.footer?.text;
  const ids = parseBatchFooterIds(rawFooter);
  if (ids === null) {
    logger.warn({ userId }, 'Missing or empty batch footer ids on deny confirm');
    await interaction
      .followUp({ content: MISSING_SELECTION_MSG, flags: MessageFlags.Ephemeral })
      .catch((followUpError: unknown) => {
        logger.warn({ err: followUpError, userId }, 'Deny batch missing-selection followUp failed');
      });
    return;
  }

  let recoveredLabels: ReadonlyMap<string, string>;
  let ownerClient: OwnerClient;
  let entries: DenylistEntryResponse[] | null;
  try {
    recoveredLabels = recoverConfirmListingLabels(interaction.message.embeds[0]?.description, ids);
    ({ ownerClient } = clientsFor(interaction));
    await interaction.editReply({ components: [] });
    entries = await fetchEntries(ownerClient);
  } catch (error) {
    logger.error({ err: error, userId }, 'Error preparing deny batch confirm');
    await interaction
      .followUp({ content: GENERIC_ERROR_MSG, flags: MessageFlags.Ephemeral })
      .catch((followUpError: unknown) => {
        logger.warn({ err: followUpError, userId }, 'Deny batch confirm error followUp failed');
      });
    return;
  }

  if (entries === null) {
    logger.warn({ userId }, 'Pre-loop denylist fetch failed on batch confirm');
    await interaction
      .followUp({
        content: renderSpec(CATALOG.error.transient(PAGE_FETCH_FAILED_COPY)),
        flags: MessageFlags.Ephemeral,
      })
      .catch((followUpError: unknown) => {
        logger.warn({ err: followUpError, userId }, 'Deny batch refusal followUp failed');
      });
    return;
  }

  const entriesById = new Map(entries.map(entry => [entry.id, entry]));
  // A full page is treated as possibly truncated because the list response cannot tell exactly-the-cap from more-than-the-cap, so the check errs toward reporting failed.
  const listTruncated = entries.length >= DENYLIST_LIST_MAX_ENTRIES;
  const results = await runBatchSequentially(ids, entryId =>
    runSingleDenyRemoval(ownerClient, entriesById, entryId, userId, listTruncated)
  );

  const lines = buildDenyBatchResultLines(results, recoveredLabels, entriesById);
  const succeeded = lines.filter(line => line.status === 'success').length;
  const gone = lines.filter(line => line.status === 'gone').length;
  const failed = lines.filter(line => line.status === 'failed').length;

  logger.info(
    { userId, requested: ids.length, succeeded, gone, failed },
    'Batch denylist removal finished'
  );

  const resultEmbed = buildBatchResultEmbed({
    title: '🗑️ Remove Denylist Entries Results',
    color: batchResultColor({ succeeded, failed }),
    lines: formatBatchItemLines(lines),
  });

  const countsLine = formatBatchCountsLine({ succeeded, gone, failed });
  const viewPromise = buildRefreshedDenyBrowseView(ownerClient, parsed).catch(
    (error: unknown): null => {
      logger.warn(
        { err: error, userId },
        'Refreshed deny browse view failed; reporting the batch result alone'
      );
      return null;
    }
  );

  await deliverBatchReport(interaction, {
    resultEmbed,
    viewPromise,
    countsLine,
    verb: 'remove',
  });
}

/** Dispatch a deny batch button interaction (`batch-select` / `batch-confirm` / `batch-cancel`). */
export async function handleDenyBatchButton(interaction: ButtonInteraction): Promise<void> {
  if (!isBotOwner(interaction.user.id)) {
    return;
  }
  const parsed = parseDenyBatchCustomId(interaction.customId);
  if (parsed?.action === DENY_BATCH_ACTION.SELECT) {
    await handleDenyBatchSelectEntry(interaction);
    return;
  }
  if (parsed?.action === DENY_BATCH_ACTION.CONFIRM) {
    await handleDenyBatchConfirm(interaction);
    return;
  }
  if (parsed?.action === DENY_BATCH_ACTION.CANCEL) {
    await handleDenyBatchCancel(interaction);
    return;
  }
  logger.debug({ customId: interaction.customId }, 'Ignoring non-batch customId');
}
