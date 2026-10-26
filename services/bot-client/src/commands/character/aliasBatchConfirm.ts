/**
 * Character Alias Batch Flow — confirm execution (removal loop + result report).
 *
 * The confirm half of `aliasBatch.ts`: strip components first, re-fetch rows
 * to resolve per-item `(slug, scope, alias)`, execute single-alias removals
 * sequentially with per-item failure isolation, and deliver the outcome report
 * stacked over the refreshed browse view via the shared survival ladder.
 */

import { escapeMarkdown, type ButtonInteraction } from 'discord.js';
import type { AliasScope } from '@tzurot/common-types/schemas/api/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { UserClient } from '@tzurot/clients';
import { clientsFor } from '../../utils/gatewayClients.js';
import { truncateForSelect } from '../../utils/browse/truncation.js';
import {
  ALREADY_GONE_NOTE,
  batchResultColor,
  buildBatchResultEmbed,
  deliverBatchReport,
  runBatchSequentially,
  formatBatchCountsLine,
  formatBatchItemLines,
  toBatchOutcomeLine,
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

const UNKNOWN_ERROR = 'Unknown';

/** Outcome of one single-alias removal call inside the batch loop. */
type AliasBatchOutcome = 'success';

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
 * (`>= SELECT_ALIAS_KEY_LENGTH`) against the fetched rows. A boundary key may
 * be the truncation of a longer alias, so two same-scope rows sharing the
 * prefix make the pick ambiguous — fail closed rather than removing whichever
 * row scans first. When zero candidates match, an untruncated list proves
 * absence (`asGone: true`), whereas a truncated list fails closed. Returns
 * `undefined` only for an unparseable or below-boundary id.
 */
function resolveBoundaryKey(
  id: string,
  rows: readonly AliasRow[],
  truncated: boolean
): ResolvedAliasItem | undefined {
  const parsed = parseSelectValueId(id);
  if (parsed === null || parsed.aliasKey.length < SELECT_ALIAS_KEY_LENGTH) {
    return undefined;
  }
  const exactMatches = rows.filter(row => formatAliasSelectValue(row) === id);
  // Case-insensitive fallback: see resolveAliasBatchItems for why a case-only difference is the same alias.
  const candidates =
    exactMatches.length > 0
      ? exactMatches
      : rows.filter(row => formatAliasSelectValue(row).toLowerCase() === id.toLowerCase());
  if (candidates.length > 1) {
    return { ok: false, label: fallbackAliasLabel(id), reason: resolutionFailureNote() };
  }
  const unambiguousRow = candidates[0];
  if (unambiguousRow === undefined) {
    return truncated
      ? { ok: false, label: fallbackAliasLabel(id), reason: resolutionFailureNote() }
      : { ok: false, label: fallbackAliasLabel(id), reason: ALREADY_GONE_NOTE, asGone: true };
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
 * Resolve one picked id against the fetched rows under the below-boundary
 * rules: exact select-value match first, then case-insensitive; when a
 * below-boundary key (`< SELECT_ALIAS_KEY_LENGTH`) misses, an untruncated list
 * proves the alias is already gone (`asGone: true` in both modes), whereas a
 * truncated list falls back to a gateway-decided item in single-character mode
 * or fails closed in my-aliases mode. Unparseable ids fail closed.
 */
function resolveFromFetchedRows(
  id: string,
  rows: readonly AliasRow[],
  coords: BrowseCoords,
  truncated: boolean
): ResolvedAliasItem {
  // Case-insensitive fallback: see resolveAliasBatchItems for why at most one row can match.
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
    if (!truncated) {
      return {
        ok: false,
        label,
        reason: ALREADY_GONE_NOTE,
        asGone: true,
      };
    }
    if (coords.query !== null) {
      return {
        ok: true,
        slug: coords.query,
        scope: parsed.scope,
        alias: parsed.aliasKey,
        label,
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
 * Canonical resolution rule for batch alias removal.
 *
 * Matches each decoded option value (`{scope}:{aliasKey}`) against the
 * pre-fetched `rows` by rebuilding `formatAliasSelectValue(row)` (`row.alias`
 * sliced to `SELECT_ALIAS_KEY_LENGTH`), trying an exact match first and a
 * case-insensitive match second. Aliases are unique on lower(alias) per tier
 * (global tier, and per user for personal rows — migration
 * 20260718162934_add_user_scoped_aliases), and the gateway DELETE matches the
 * alias case-insensitively, so a case-only difference is the same alias and at
 * most one row can match below the boundary:
 * - Boundary keys (`aliasKey.length >= SELECT_ALIAS_KEY_LENGTH`) may be the
 *   truncation of a longer alias: a unique match resolves to that row; more
 *   than one match is ambiguous and fails closed; zero matches report already
 *   gone (`asGone: true`) when `truncated` is `false` (the complete list
 *   proves absence) or fail closed when `truncated` is `true`. A boundary key
 *   is a prefix, so if the picked alias was deleted after the pick and a
 *   different alias sharing that `SELECT_ALIAS_KEY_LENGTH` prefix exists in
 *   the same scope (only possible across pages or filters, since one menu
 *   rejects duplicate values), the unique candidate is that other alias and it
 *   is removed; the footer carries no more of the alias than the select value,
 *   so this is an accepted limit.
 * - Below-boundary keys (`aliasKey.length < SELECT_ALIAS_KEY_LENGTH`) carry
 *   the full alias: a matched row resolves to that row; on a miss, an
 *   untruncated list (`!truncated`) proves absence and reports already gone
 *   (`asGone: true`) in both modes, while a truncated list (`truncated`)
 *   falls back to `coords.query` + `aliasKey` in single-character mode
 *   (`coords.query !== null`) so the gateway DELETE decides, or fails closed
 *   in my-aliases mode (`coords.query === null`).
 * - Unparseable ids always fail closed.
 */
export function resolveAliasBatchItems(
  ids: readonly string[],
  rows: readonly AliasRow[],
  coords: BrowseCoords,
  truncated: boolean
): Map<string, ResolvedAliasItem> {
  const resolved = new Map<string, ResolvedAliasItem>();

  for (const id of ids) {
    const boundaryItem = resolveBoundaryKey(id, rows, truncated);
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
 * `result.ok` → `'success'`; any non-ok status (including `404`, since the
 * gateway also 404s an invisible character, and `0` on a network failure or
 * timeout) raises a formatted error so `runBatchSequentially` isolates and
 * records it as failed.
 */
async function runSingleAliasRemoval(
  userClient: UserClient,
  target: { slug: string; scope: AliasScope; alias: string },
  userId: string
): Promise<AliasBatchOutcome> {
  let result: Awaited<ReturnType<UserClient['removePersonalityAlias']>>;
  try {
    result = await userClient.removePersonalityAlias(target.slug, target.alias, {
      scope: target.scope,
    });
  } catch (error) {
    // The client returns an envelope for network failures and timeouts, so this catch only guards against a client-contract change.
    logger.warn(
      { err: error, userId, slug: target.slug, scope: target.scope },
      'Batch alias removal item threw'
    );
    throw new Error(aliasFailureSpec(500, UNKNOWN_ERROR).text, { cause: error });
  }
  if (result.ok) {
    return 'success';
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
      return [
        result.id,
        toBatchOutcomeLine(result, label, aliasFailureSpec(500, UNKNOWN_ERROR).text),
      ];
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
    color: batchResultColor({ succeeded, failed }),
    lines: formatBatchItemLines(lines),
  });

  const countsLine = formatBatchCountsLine({ succeeded, gone, failed });
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
  const userId = interaction.user.id;
  let coords: BrowseCoords | null;
  let ids: string[] | null;
  let userClient: UserClient;
  let fetched: Awaited<ReturnType<typeof fetchAliasRows>>;

  try {
    // Explicit double-ack guard: the confirm handler is also called standalone
    // (tests); no router pre-acks it; the guard keeps it safe if one ever does.
    if (!interaction.deferred && !interaction.replied) {
      await ackUpdate(interaction);
    }

    coords = parseRemoveCustomId(interaction.customId, BATCH_CONFIRM_PREFIX);
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

    ids = parseAliasBatchFooterIds(rawFooter);
    if (ids === null) {
      const msg =
        "Couldn't tell which aliases were selected — please run `/character alias browse` and try again.";
      await followUpSpec(interaction, CATALOG.error.validation(msg));
      return;
    }

    ({ userClient } = clientsFor(interaction));
    await interaction.editReply({ components: [] });

    fetched = await fetchAliasRows(userClient, coords.query);
    if (!fetched.ok) {
      await followUpSpec(interaction, CATALOG.error.transient(PAGE_FETCH_FAILED_COPY));
      return;
    }
  } catch (error) {
    // Nothing has been removed yet on this path, so a plain failure notice is safe.
    // Guard on deferred || replied: if ackUpdate itself rejected, followUp would
    // throw InteractionNotReplied and the token or 3-second window is already gone.
    logger.error({ err: error, userId }, 'Error preparing alias batch confirm');
    if (interaction.deferred || interaction.replied) {
      await followUpSpec(interaction, CATALOG.error.transient(PAGE_FETCH_FAILED_COPY)).catch(
        (followUpError: unknown) => {
          logger.warn({ err: followUpError, userId }, 'Alias batch confirm error followUp failed');
        }
      );
    }
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
    // Unreachable because runIds holds only resolved items; it exists to narrow the type.
    if (item?.ok !== true) {
      throw new Error(aliasFailureSpec(500, UNKNOWN_ERROR).text);
    }
    return runSingleAliasRemoval(userClient, item, userId);
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
