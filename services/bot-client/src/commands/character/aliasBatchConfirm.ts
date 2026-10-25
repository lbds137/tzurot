/**
 * Character Alias Batch Flow — confirm execution (removal loop + result report).
 *
 * The confirm half of `aliasBatch.ts`: strip components first, re-fetch rows
 * to resolve per-item `(slug, scope, alias)`, execute single-alias removals
 * sequentially with per-item failure isolation, and deliver the outcome report
 * stacked over the refreshed browse view via the shared survival ladder.
 */

import { escapeMarkdown, type ButtonInteraction } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import type { AliasScope } from '@tzurot/common-types/schemas/api/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { UserClient } from '@tzurot/clients';
import { clientsFor } from '../../utils/gatewayClients.js';
import { truncateForSelect } from '../../utils/browse/truncation.js';
import {
  buildBatchResultEmbed,
  deliverBatchReport,
  runBatchSequentially,
  formatBatchItemLines,
  PAGE_FETCH_FAILED_COPY,
  type BatchItemResult,
  type BatchResultLine,
} from '../../utils/browse/multiSelectBatch.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { followUpSpec, ackUpdate } from '../../ux/render/reply.js';
import { fetchAliasRows, type AliasRow } from './aliasData.js';
import { BROWSE_COMMAND_HINT, aliasFailureSpec, parseRemoveCustomId } from './aliasBrowse.js';
import {
  SELECT_ALIAS_KEY_LENGTH,
  buildRefreshedAliasView,
  formatAliasSelectOption,
  formatAliasSelectValue,
  type BrowseCoords,
} from './aliasBrowseView.js';
import {
  BATCH_CONFIRM_PREFIX,
  SELECTION_TOO_LARGE_COPY,
  exceedsBatchFooterBudget,
  fallbackAliasLabel,
  parseAliasBatchFooterIds,
  parseSelectValueId,
} from './aliasBatch.js';

const logger = createLogger('character-alias-batch');

const ALREADY_GONE_NOTE = 'already gone';
const UNKNOWN_ERROR = 'Unknown';

/** Outcome of one single-alias removal call inside the batch loop. */
type AliasBatchOutcome = 'success' | 'already-gone';

/** Pre-loop resolution for one selected option value. */
export type ResolvedAliasItem =
  | { ok: true; slug: string; scope: AliasScope; alias: string; label: string }
  | { ok: false; label: string; reason: string; asGone?: true };

/** Outcome counts for a finished alias batch removal run. */
interface AliasBatchCounts {
  succeeded: number;
  gone: number;
  failed: number;
}

// Built only when a resolution fails; the note carries the spec's plain
// text — formatBatchItemLines prefixes the line's own status glyph.
const resolutionFailureNote = (): string =>
  CATALOG.error.validation(
    'Could not resolve the full alias on this page — please refresh and try again.'
  ).text;

/**
 * Resolve one picked id whose key sits at or above the boundary length
 * (>= SELECT_ALIAS_KEY_LENGTH) against the fetched rows. A boundary key may
 * be the truncation of a longer alias, so two same-scope rows sharing the
 * prefix make the pick ambiguous — fail closed rather than removing whichever
 * row scans first. (The single-pick confirm shows the resolved full alias
 * before the user commits; this flow has no per-item confirm.) Returns
 * undefined for a below-boundary or unparseable id, and when no row matches
 * — the caller falls through to the page-resolution path.
 */
function resolveBoundaryKey(id: string, rows: readonly AliasRow[]): ResolvedAliasItem | undefined {
  const parsed = parseSelectValueId(id);
  if (parsed === null || parsed.aliasKey.length < SELECT_ALIAS_KEY_LENGTH) {
    return undefined;
  }
  const exactMatches = rows.filter(row => formatAliasSelectValue(row) === id);
  const candidates =
    exactMatches.length > 0
      ? exactMatches
      : rows.filter(row => formatAliasSelectValue(row).toLowerCase() === id.toLowerCase());
  if (candidates.length > 1) {
    return { ok: false, label: fallbackAliasLabel(id), reason: resolutionFailureNote() };
  }
  const unambiguousRow = candidates[0];
  if (unambiguousRow === undefined) {
    return undefined;
  }
  return {
    ok: true,
    slug: unambiguousRow.character.slug,
    scope: unambiguousRow.scope,
    alias: unambiguousRow.alias,
    label: formatAliasSelectOption(unambiguousRow).label,
  };
}

/**
 * Resolve one picked id against the fetched page under the below-boundary
 * rules: exact select-value match first, then case-insensitive; a miss falls
 * to the parsed-key paths (gateway-decided in single-character mode,
 * already-gone in my-aliases mode when the list is untruncated) and finally
 * the shared resolution-failure tail.
 */
function resolveFromFetchedRows(
  id: string,
  rows: readonly AliasRow[],
  coords: BrowseCoords,
  truncated: boolean
): ResolvedAliasItem {
  const matchedRow =
    rows.find(row => formatAliasSelectValue(row) === id) ??
    rows.find(row => formatAliasSelectValue(row).toLowerCase() === id.toLowerCase());

  if (matchedRow !== undefined) {
    const label = formatAliasSelectOption(matchedRow).label;
    return {
      ok: true,
      slug: matchedRow.character.slug,
      scope: matchedRow.scope,
      alias: matchedRow.alias,
      label,
    };
  }

  const parsed = parseSelectValueId(id);
  if (parsed !== null && parsed.aliasKey.length < SELECT_ALIAS_KEY_LENGTH) {
    const label = truncateForSelect(`@${parsed.aliasKey}`, { stripNewlines: true });
    if (coords.query !== null) {
      return {
        ok: true,
        slug: coords.query,
        scope: parsed.scope,
        alias: parsed.aliasKey,
        label,
      };
    }
    if (!truncated) {
      return {
        ok: false,
        label,
        reason: ALREADY_GONE_NOTE,
        asGone: true,
      };
    }
  }

  return {
    ok: false,
    label: fallbackAliasLabel(id),
    reason: resolutionFailureNote(),
  };
}

/**
 * Match each decoded option value against the fetched rows by rebuilding
 * `${row.scope}:${row.alias.slice(0, SELECT_ALIAS_KEY_LENGTH)}`. A key of
 * length 92 may be either a full alias or the truncation of a longer one, so
 * it is ambiguous and fails closed — only
 * `aliasKey.length < SELECT_ALIAS_KEY_LENGTH` counts as untruncated. When an
 * untruncated row misses: in single-character mode
 * (`coords.query !== null`), fall back to `coords.query` + `aliasKey` so the
 * gateway call decides 200 vs 404; in my-aliases mode (`coords.query === null`),
 * a missing untruncated key is already gone only when `truncated` is `false`
 * (when `truncated` is `true`, absence from the capped list is not evidence
 * of deletion, so resolution fails). Select-value collisions below the
 * boundary length are accepted; a boundary-length key matching more than one
 * row fails closed — see `formatAliasSelectValue` in aliasBrowseView.ts.
 */
export function resolveAliasBatchItems(
  ids: readonly string[],
  rows: readonly AliasRow[],
  coords: BrowseCoords,
  truncated: boolean
): Map<string, ResolvedAliasItem> {
  const resolved = new Map<string, ResolvedAliasItem>();

  for (const id of ids) {
    const boundaryItem = resolveBoundaryKey(id, rows);
    if (boundaryItem !== undefined) {
      resolved.set(id, boundaryItem);
      continue;
    }
    resolved.set(id, resolveFromFetchedRows(id, rows, coords, truncated));
  }

  return resolved;
}

/**
 * Execute one alias removal against the gateway envelope contract:
 * `result.ok` → `'success'`, `404` → `'already-gone'`, any other failure
 * throws a formatted error so `runBatchSequentially` isolates and records it.
 */
async function runSingleAliasRemoval(
  userClient: UserClient,
  target: { slug: string; scope: AliasScope; alias: string }
): Promise<AliasBatchOutcome> {
  const result = await userClient.removePersonalityAlias(target.slug, target.alias, {
    scope: target.scope,
  });
  if (result.ok) {
    return 'success';
  }
  if (result.status === 404) {
    return 'already-gone';
  }
  throw new Error(aliasFailureSpec(result.status, result.error ?? UNKNOWN_ERROR).text);
}

function formatDisplayLabel(rawLabel: string): string {
  return escapeMarkdown(truncateForSelect(rawLabel, { stripNewlines: true }));
}

function buildAliasBatchResultLines(
  ids: readonly string[],
  resolvedMap: ReadonlyMap<string, ResolvedAliasItem>,
  results: readonly BatchItemResult<AliasBatchOutcome>[]
): BatchResultLine[] {
  const resultMap = new Map<string, BatchResultLine>(
    results.map(result => {
      const item = resolvedMap.get(result.id);
      const label = formatDisplayLabel(item?.label ?? fallbackAliasLabel(result.id));
      if (!result.ok) {
        const reason =
          result.error instanceof Error && result.error.message.length > 0
            ? result.error.message
            : aliasFailureSpec(500, UNKNOWN_ERROR).text;
        return [result.id, { label, status: 'failed', note: reason }];
      }
      const line: BatchResultLine =
        result.value === 'success'
          ? { label, status: 'success' }
          : { label, status: 'gone', note: ALREADY_GONE_NOTE };
      return [result.id, line];
    })
  );

  return ids.map(id => {
    const fromRun = resultMap.get(id);
    if (fromRun !== undefined) {
      return fromRun;
    }
    const item = resolvedMap.get(id);
    const label = formatDisplayLabel(item?.label ?? fallbackAliasLabel(id));
    if (item !== undefined && !item.ok && item.asGone === true) {
      return { label, status: 'gone', note: item.reason };
    }
    const reason =
      item !== undefined && !item.ok ? item.reason : aliasFailureSpec(500, UNKNOWN_ERROR).text;
    return { label, status: 'failed', note: reason };
  });
}

async function deliverAliasBatchResult(
  interaction: ButtonInteraction,
  options: {
    userClient: UserClient;
    coords: BrowseCoords;
    counts: AliasBatchCounts;
    lines: readonly BatchResultLine[];
  }
): Promise<void> {
  const { userClient, coords, counts, lines } = options;
  const { succeeded, gone, failed } = counts;
  const resultEmbed = buildBatchResultEmbed({
    title: '🗑️ Remove Aliases Results',
    color:
      failed > 0
        ? DISCORD_COLORS.ERROR
        : succeeded === 0
          ? DISCORD_COLORS.WARNING
          : DISCORD_COLORS.SUCCESS,
    lines: formatBatchItemLines(lines),
  });

  const countsLine = `Batch finished: ${succeeded} succeeded, ${gone} already gone, ${failed} failed.`;
  const viewPromise = buildRefreshedAliasView(userClient, coords).catch((error: unknown): null => {
    logger.warn({ err: error }, 'Refreshed alias view failed; reporting the batch result alone');
    return null;
  });

  await deliverBatchReport(interaction, { resultEmbed, viewPromise, countsLine, verb: 'remove' });
}

/**
 * Confirm batch removal — strip components first, re-fetch rows to resolve
 * per-item `(slug, scope, alias)`, run removals sequentially with per-item
 * failure isolation, and deliver the stacked report.
 */
export async function handleAliasBatchConfirm(interaction: ButtonInteraction): Promise<void> {
  // Explicit double-ack guard: the confirm handler is also invoked standalone
  // (tests), and ackUpdate defers unconditionally.
  if (!interaction.deferred && !interaction.replied) {
    await ackUpdate(interaction);
  }

  const coords = parseRemoveCustomId(interaction.customId, BATCH_CONFIRM_PREFIX);
  if (coords === null) {
    await followUpSpec(interaction, CATALOG.progress.sessionExpired(BROWSE_COMMAND_HINT));
    return;
  }

  const rawFooter = interaction.message.embeds[0]?.footer?.text;
  // Defense in depth — pick time already refuses an over-budget selection.
  if (rawFooter !== undefined && exceedsBatchFooterBudget(rawFooter)) {
    await followUpSpec(interaction, CATALOG.error.validation(SELECTION_TOO_LARGE_COPY));
    return;
  }

  const ids = parseAliasBatchFooterIds(rawFooter);
  if (ids === null) {
    const msg =
      "Couldn't tell which aliases were selected — please run `/character alias browse` and try again.";
    await followUpSpec(interaction, CATALOG.error.validation(msg));
    return;
  }

  const { userClient } = clientsFor(interaction);
  await interaction.editReply({ components: [] });

  const fetched = await fetchAliasRows(userClient, coords.query);
  if (!fetched.ok) {
    await followUpSpec(interaction, CATALOG.error.transient(PAGE_FETCH_FAILED_COPY));
    return;
  }

  const resolvedMap = resolveAliasBatchItems(
    ids,
    fetched.data.rows,
    coords,
    fetched.data.truncated
  );
  const runIds = ids.filter(id => resolvedMap.get(id)?.ok === true);

  const results = await runBatchSequentially(runIds, async id => {
    const item = resolvedMap.get(id);
    if (item?.ok !== true) {
      throw new Error(aliasFailureSpec(500, UNKNOWN_ERROR).text);
    }
    return runSingleAliasRemoval(userClient, item);
  });

  const lines = buildAliasBatchResultLines(ids, resolvedMap, results);
  const succeeded = lines.filter(line => line.status === 'success').length;
  const gone = lines.filter(line => line.status === 'gone').length;
  const failed = lines.filter(line => line.status === 'failed').length;
  const counts: AliasBatchCounts = { succeeded, gone, failed };

  logger.info(
    { query: coords.query, filter: coords.filter, requested: ids.length, ...counts },
    'Batch alias removal finished'
  );

  await deliverAliasBatchResult(interaction, { userClient, coords, counts, lines });
}
