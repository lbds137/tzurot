/**
 * Memory Facts Batch Flow ("Select several")
 *
 * Multi-select batch actions over the facts browse list: pick several facts
 * in one menu, confirm Lock or Forget for all of them in one view, then get
 * a per-item outcome listing (successes, gone items, locked skips and
 * failures; a pick that left the page is resolved by a per-id read).
 * Execution loops the single-id gateway calls with per-item
 * isolation — no batch route.
 *
 * Component contract:
 * - `memory-fact::batch-select` — the "Select several" toggle button (swaps
 *   the page into multi-select mode) AND the multi-select menu itself; the
 *   router dispatches by interaction kind.
 * - `memory-fact::batch-confirm::<forget|lock>` — the verb buttons; the verb
 *   rides the factId slot of the action id.
 * - the selected fact ids ride the confirm embed's FOOTER, one per line.
 */

import {
  MessageFlags,
  escapeMarkdown,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type UserClient } from '@tzurot/clients';
import { clientsFor } from '../../utils/gatewayClients.js';
import { buildBrowseSelectMenu } from '../../utils/browse/selectMenuBuilder.js';
import {
  batchResultColor,
  buildBatchModeRows,
  buildBatchConfirmView,
  buildBatchResultEmbed,
  clampBatchConfirmDescription,
  deliverBatchReport,
  encodeBatchFooterIds,
  formatFallbackIdLabel,
  parseBatchFooterIds,
  readSelectOptionLabels,
  runBatchSequentially,
  formatBatchItemLines,
  PAGE_FETCH_FAILED_COPY,
  type BatchResultLine,
} from '../../utils/browse/multiSelectBatch.js';
import { truncateForSelect } from '../../utils/browse/truncation.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';
import { followUpSpec, ackUpdate } from '../../ux/render/reply.js';
import {
  FACTS_PER_PAGE,
  FACTS_SESSION_EXPIRED,
  fetchCurrentFactsPage,
  buildFactsEmbed,
  formatFactSelectOption,
  buildRefreshedFactsView,
} from './factsBrowse.js';
import { buildFactActionId } from './factsDetail.js';
import { fetchFact, forgetFact, setFactLock, type FactItem } from './factsApi.js';
import {
  buildSkippedLockableLine,
  countLockableBatchLines,
  formatLockableCountsLine,
  resolveMissingLockableLabels,
  toLockableResultLine,
  type LockableBatchCounts,
  type LockableBatchNouns,
  type LockableBatchRunOptions,
  type LockableGoneIds,
  type LockableLabelReadErrors,
  type ResolvedLockableLabel,
} from './lockableBatchOutcome.js';

const logger = createLogger('memory-facts-batch');

/** What a confirmed batch verb does per fact. */
export type BatchVerb = 'forget' | 'lock';

/** Outcome of one single-id gateway call inside the batch loop. */
type BatchVerbOutcome = 'success' | 'already-gone';

/** Fallback display label when a fact's real label can't be resolved. */
function fallbackFactLabel(id: string): string {
  return formatFallbackIdLabel(id, 'Fact');
}

/** Swap-render components: the multi-select page plus a Cancel affordance. */
export function buildBatchSelectComponents(
  facts: FactItem[],
  page: number
): ReturnType<typeof buildBatchModeRows> {
  const selectRow = buildBrowseSelectMenu<FactItem>({
    items: facts,
    customId: buildFactActionId('batch-select'),
    placeholder: 'Select several facts to manage...',
    startIndex: page * FACTS_PER_PAGE,
    maxValues: FACTS_PER_PAGE,
    formatItem: formatFactSelectOption,
  });
  return buildBatchModeRows({
    selectRow,
    cancelCustomId: buildFactActionId('batch-cancel'),
  });
}

/**
 * "Select several" entry — swap the current page into multi-select mode.
 * Ack-first; the page state lives in the dashboard session like pagination.
 */
export async function handleBatchSelectEntry(interaction: ButtonInteraction): Promise<void> {
  await ackUpdate(interaction);

  const result = await fetchCurrentFactsPage(interaction);
  if (!result.ok) {
    await interaction.followUp({
      content:
        result.reason === 'session-gone'
          ? FACTS_SESSION_EXPIRED
          : renderSpec(CATALOG.error.transient(PAGE_FETCH_FAILED_COPY)),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { currentPage, tag, query } = result.session.data;
  await interaction.editReply({
    embeds: [
      buildFactsEmbed({
        facts: result.data.facts,
        total: result.data.total,
        page: currentPage,
        tag,
        query,
      }),
    ],
    components: buildBatchSelectComponents(result.data.facts, currentPage),
  });
}

/**
 * Multi-select finished — show the confirm view listing EVERY selected fact,
 * with Lock / Forget verb buttons and Cancel. The selected ids ride the
 * embed footer so the confirm handler can recover them (aliasBrowse pattern).
 */
export async function handleBatchPick(interaction: StringSelectMenuInteraction): Promise<void> {
  await ackUpdate(interaction);

  const ids = interaction.values.filter(value => value.length > 0);
  if (ids.length === 0) {
    await followUpSpec(interaction, CATALOG.error.validation('No facts were selected.'));
    return;
  }

  const labels = readSelectOptionLabels(interaction.message);
  const listing = ids
    .map(id => {
      const label = labels.get(id) ?? fallbackFactLabel(id);
      return `• ${escapeMarkdown(label)}`;
    })
    .join('\n');
  const warning =
    `**This affects ${ids.length} ${ids.length === 1 ? 'fact' : 'facts'} immediately.** ` +
    'Forget is permanent — forgotten facts are never re-learned.';

  const { embed, components } = buildBatchConfirmView({
    title: '⚠️ Manage Several Facts',
    description: clampBatchConfirmDescription(listing, warning),
    footerText: encodeBatchFooterIds(ids),
    // The factory row is Cancel → Forget (Danger), Danger last; the
    // Secondary Lock verb rides its own row ABOVE the confirm row.
    secondaryVerb: {
      customId: buildFactActionId('batch-confirm', 'lock'),
      label: `Lock (${ids.length})`,
      emoji: '🔐',
    },
    confirm: {
      customId: buildFactActionId('batch-confirm', 'forget'),
      label: `Forget (${ids.length})`,
      emoji: '🗑️',
    },
    cancelCustomId: buildFactActionId('batch-cancel'),
  });

  await interaction.editReply({ embeds: [embed], components });
}

/** One single-id gateway call, mapped to the batch outcome vocabulary. */
async function runBatchVerb(
  userClient: UserClient,
  verb: BatchVerb,
  factId: string,
  userId: string
): Promise<BatchVerbOutcome> {
  if (verb === 'forget') {
    return (await forgetFact(userClient, factId, userId)) ? 'success' : 'already-gone';
  }
  const updated = await setFactLock(userClient, factId, true, userId);
  return updated === null ? 'already-gone' : 'success';
}

/**
 * Why a confirm must refuse before any mutation: the browse session no longer
 * exists, or the pre-loop page fetch failed (transient gateway error).
 */
type BatchLabelsRefusal = 'session-gone' | 'fetch-failed';

/**
 * Result-time labels, resolved BEFORE the loop mutates the page: one page
 * fetch matches every still-present id, and a selected id the page fetch
 * misses gets the per-id read, so its real label and lock state survive the
 * drift (an id-prefix fallback only for reads that 404 — those ids are
 * recorded gone and skip the mutation entirely). The reads run in parallel:
 * they are independent per id and the results are keyed, so no ordering
 * dependency exists (the mutations after them stay sequential). A refusal
 * means the caller must refuse BEFORE mutating, because the outcome report
 * could not name the facts it acted on — true for BOTH refusal reasons: a
 * gone session and a failed fetch alike leave no honest basis for the run.
 */
async function resolveBatchLabels(
  interaction: ButtonInteraction,
  userClient: UserClient,
  ids: readonly string[],
  userId: string
): Promise<
  | {
      ok: true;
      labels: Map<string, ResolvedLockableLabel>;
      readErrors: LockableLabelReadErrors;
      goneIds: LockableGoneIds;
    }
  | { ok: false; reason: BatchLabelsRefusal }
> {
  const resolved = new Map<string, ResolvedLockableLabel>();
  const readErrors: LockableLabelReadErrors = new Map();
  const goneIds: LockableGoneIds = new Set();
  const idSet = new Set(ids);
  const result = await fetchCurrentFactsPage(interaction);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  for (const fact of result.data.facts) {
    if (idSet.has(fact.id)) {
      resolved.set(fact.id, {
        label: formatFactSelectOption(fact).label,
        isLocked: fact.isLocked,
      });
    }
  }
  const missingIds = ids.filter(factId => !resolved.has(factId));
  await resolveMissingLockableLabels(
    missingIds,
    {
      read: id => fetchFact(userClient, id, userId),
      toLabel: fact => formatFactSelectOption(fact).label,
      fallbackLabel: fallbackFactLabel,
    },
    { resolved, readErrors, goneIds }
  );
  return { ok: true, labels: resolved, readErrors, goneIds };
}

/** Deliver a confirm refusal (nothing has mutated) with the reason-honest copy. */
async function replyBatchRefusal(
  interaction: ButtonInteraction,
  reason: BatchLabelsRefusal
): Promise<void> {
  if (reason === 'fetch-failed') {
    // A live session with a failed fetch is NOT an expired session —
    // transient copy, not the expiry copy.
    await followUpSpec(interaction, CATALOG.error.transient(PAGE_FETCH_FAILED_COPY));
    return;
  }
  await interaction.followUp({
    content: FACTS_SESSION_EXPIRED,
    flags: MessageFlags.Ephemeral,
  });
}

const FACT_BATCH_NOUNS = {
  noun: 'fact',
  destroyVerb: 'forget',
} satisfies LockableBatchNouns;

/**
 * Deliver the outcome report: build the result embed (the color ladder is the
 * flow's own — red for a real failure; warning amber when nothing succeeded
 * AND nothing failed (all locked / all already-gone — no work was actually
 * done); green otherwise), wrap the refreshed list view, and hand both to the
 * shared survival ladder (deliverBatchReport): the mutations have already
 * run, so the report must survive reply failures on EVERY branch.
 */
async function deliverBatchResult(
  interaction: ButtonInteraction,
  verb: BatchVerb,
  counts: LockableBatchCounts,
  lines: readonly BatchResultLine[]
): Promise<void> {
  const { succeeded, failed } = counts;
  const resultEmbed = buildBatchResultEmbed({
    title: verb === 'forget' ? '🗑️ Forget Results' : '🔐 Lock Results',
    color: batchResultColor({ succeeded, failed }),
    lines: formatBatchItemLines(lines),
  });

  const countsLine = formatLockableCountsLine(counts, verb === 'forget');

  // Rider on the survival ladder: the refreshed view does session-manager
  // round-trips that can throw AFTER the mutations ran — a throw must
  // degrade to the result-only reply, never lose the report.
  const viewPromise = buildRefreshedFactsView(interaction).catch((error: unknown): null => {
    logger.warn({ err: error, verb }, 'Refreshed facts view failed; reporting the result alone');
    return null;
  });

  await deliverBatchReport(interaction, { resultEmbed, viewPromise, countsLine, verb });
}

/**
 * Confirm verb — run the loop sequentially with per-item isolation, then
 * render a result embed naming every item's outcome on top of the refreshed
 * list view.
 */
export async function handleBatchConfirm(
  interaction: ButtonInteraction,
  verb: BatchVerb
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await ackUpdate(interaction);
  }

  const ids = parseBatchFooterIds(interaction.message.embeds[0]?.footer?.text);
  if (ids === null) {
    await followUpSpec(
      interaction,
      CATALOG.error.validation(
        "Couldn't tell which facts were selected — please run `/memory facts` and try again."
      )
    );
    return;
  }

  const userId = interaction.user.id;
  const { userClient } = clientsFor(interaction);

  // Strip the confirm buttons to shrink the double-tap window to the ack +
  // strip round-trips themselves — a tap Discord delivers inside that window
  // still runs the whole flow. After the strip, later taps find nothing to
  // act on. The embeds stay untouched: the confirm view remains visible but
  // inert. A refusal below loses only that inert view — its followUp copy
  // tells the user to re-run.
  await interaction.editReply({ components: [] });

  // Labels come from a fetch made BEFORE the loop: after it runs, the
  // successfully forgotten facts are gone from the page and their real
  // statements would be unrecoverable. BOTH refusal cases — a gone session
  // and a failed pre-loop fetch — refuse BEFORE any gateway call: the
  // outcome report could not name the facts it acted on, so no mutation may
  // run on that basis.
  const resolved = await resolveBatchLabels(interaction, userClient, ids, userId);
  if (!resolved.ok) {
    await replyBatchRefusal(interaction, resolved.reason);
    return;
  }
  const labels = resolved.labels;

  const lockedIds = new Set(
    [...labels.entries()].filter(([, meta]) => meta.isLocked === true).map(([factId]) => factId)
  );
  // A LOCK run must not re-send setFactLock(true) for an already-locked id
  // and report success: an id whose lock state could not be resolved (off the
  // page AND its per-id read failed) is failed upfront WITHOUT mutating. The
  // forget run needs no such guard — its 403 names locked ids honestly, and
  // a forgotten id needs no lock state at all.
  const unverifiableIds = verb === 'lock' ? new Set(resolved.readErrors.keys()) : new Set<string>();
  // A gone id (its per-id read 404'd) skips the mutation for BOTH verbs: the
  // forget call would return false and the lock call null — the same
  // already-gone outcome, reached without the wasted gateway call.
  const runIds = ids.filter(
    factId =>
      !lockedIds.has(factId) && !unverifiableIds.has(factId) && !resolved.goneIds.has(factId)
  );
  const results = await runBatchSequentially(runIds, factId =>
    runBatchVerb(userClient, verb, factId, userId)
  );

  // Same truncation the select menu applies to option labels — the result
  // lines must not resurrect the full statement the menu clipped.
  const labelFor = (factId: string): string =>
    escapeMarkdown(
      truncateForSelect(labels.get(factId)?.label ?? fallbackFactLabel(factId), {
        stripNewlines: true,
      })
    );

  const runOptions = {
    destroying: verb === 'forget',
    nouns: FACT_BATCH_NOUNS,
  } satisfies LockableBatchRunOptions;
  const toResultLine = (result: (typeof results)[number]): BatchResultLine =>
    toLockableResultLine(result, labelFor(result.id), runOptions);

  // Original ids order: loop results where the id ran, upfront skips otherwise (see buildSkippedLockableLine).
  const resultLines = new Map<string, BatchResultLine>(
    results.map(result => [result.id, toResultLine(result)])
  );
  const skips = { goneIds: resolved.goneIds, lockedIds, readErrors: resolved.readErrors };
  const lines = ids.map(
    (factId): BatchResultLine =>
      resultLines.get(factId) ??
      buildSkippedLockableLine(factId, labelFor(factId), skips, runOptions)
  );

  const counts = countLockableBatchLines(lines);
  logger.info({ userId, verb, requested: ids.length, ...counts }, 'Batch fact action finished');

  await deliverBatchResult(interaction, verb, counts, lines);
}
