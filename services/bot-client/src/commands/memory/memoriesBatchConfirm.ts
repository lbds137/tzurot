/**
 * Memory Batch Flow — confirm execution (Delete / Lock run + result report).
 *
 * The verb half of memoriesBatch.ts: resolve result-time labels BEFORE the
 * loop (a post-loop page no longer carries what the run deleted), execute
 * the single-id gateway calls sequentially with per-item isolation, and
 * deliver the outcome report through the shared survival ladder — the
 * mutations have already run, so the report must survive every reply failure.
 */

import { escapeMarkdown, type ButtonInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type UserClient } from '@tzurot/clients';
import { clientsFor } from '../../utils/gatewayClients.js';
import {
  batchResultColor,
  buildBatchResultEmbed,
  deliverBatchReport,
  parseBatchFooterIds,
  runBatchSequentially,
  formatBatchItemLines,
  type BatchResultLine,
} from '../../utils/browse/multiSelectBatch.js';
import { truncateForSelect } from '../../utils/browse/truncation.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { followUpSpec, ackUpdate } from '../../ux/render/reply.js';
import { type MemoryListSession } from './browseSession.js';
import { fetchMemory, setMemoryLock, deleteMemory } from './detailApi.js';
import { buildRefreshedBrowseView, formatMemorySelectOption } from './browse.js';
import { buildRefreshedSearchView } from './search.js';
import { fallbackMemoryLabel, fetchPageForSession, itemsOf } from './memoriesBatch.js';
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

const logger = createLogger('memory-memories-batch-confirm');

/** What a confirmed batch verb does per memory. */
export type BatchVerb = 'delete' | 'lock';

/** Outcome of one single-id gateway call inside the batch loop. */
type BatchVerbOutcome = 'success' | 'already-gone';

/** One single-id gateway call, mapped to the batch outcome vocabulary. */
async function runBatchVerb(
  userClient: UserClient,
  verb: BatchVerb,
  memoryId: string,
  userId: string
): Promise<BatchVerbOutcome> {
  if (verb === 'delete') {
    return (await deleteMemory(userClient, memoryId, userId)) ? 'success' : 'already-gone';
  }
  const updated = await setMemoryLock(userClient, memoryId, true, userId);
  return updated === null ? 'already-gone' : 'success';
}

/**
 * Result-time labels, resolved BEFORE the loop mutates the page: on a browse
 * session one page fetch matches every still-present id; on a search session
 * EVERY selected id resolves through the per-id read (drift-proof by
 * construction — no semantic re-search, no embedding round-trip). A browse id
 * the page fetch misses gets the same per-id read, so its real label and lock
 * state survive the drift (an id-prefix fallback for reads that 404, which
 * are recorded gone and skip the mutation, or that fail). The reads run
 * in parallel: they are independent per id and the results are keyed, so no
 * ordering dependency exists (the mutations after them stay sequential). The
 * only refusal is a failed browse page fetch: the caller must refuse BEFORE
 * mutating, because the outcome report could not name the memories it acted
 * on. (A gone session is refused by the router before this handler runs.)
 */
async function resolveBatchLabels(
  userClient: UserClient,
  session: { data: MemoryListSession },
  ids: readonly string[],
  userId: string
): Promise<
  | {
      ok: true;
      labels: Map<string, ResolvedLockableLabel>;
      readErrors: LockableLabelReadErrors;
      goneIds: LockableGoneIds;
    }
  | {
      ok: false;
      reason: 'fetch-failed';
    }
> {
  const resolved = new Map<string, ResolvedLockableLabel>();
  const readErrors: LockableLabelReadErrors = new Map();
  const goneIds: LockableGoneIds = new Set();
  const idSet = new Set(ids);
  if (session.data.kind === 'browse') {
    const data = await fetchPageForSession(userClient, session.data, session.data.currentPage);
    if (data === null) {
      return { ok: false, reason: 'fetch-failed' };
    }
    for (const memory of itemsOf(data)) {
      if (idSet.has(memory.id)) {
        resolved.set(memory.id, {
          label: formatMemorySelectOption(memory).label,
          isLocked: memory.isLocked,
        });
      }
    }
  }
  const missingIds = ids.filter(id => !resolved.has(id));
  await resolveMissingLockableLabels(
    missingIds,
    {
      read: id => fetchMemory(userClient, id, userId),
      toLabel: memory => formatMemorySelectOption(memory).label,
      fallbackLabel: fallbackMemoryLabel,
    },
    { resolved, readErrors, goneIds }
  );
  return { ok: true, labels: resolved, readErrors, goneIds };
}

const MEMORY_BATCH_NOUNS = {
  noun: 'memory',
  destroyVerb: 'delete',
} satisfies LockableBatchNouns;

/**
 * Deliver the outcome report: build the result embed (the color ladder is the
 * flow's own — red for a real failure; warning amber when nothing succeeded
 * AND nothing failed (all locked / all already-gone — no work was actually
 * done); green otherwise), wrap the kind-refreshed list view, and hand both
 * to the shared survival ladder (deliverBatchReport): the mutations have
 * already run, so the report must survive reply failures on EVERY branch
 * (6000-char sum budget; see buildBatchResultEmbed).
 */
async function deliverBatchResult(
  interaction: ButtonInteraction,
  session: { data: MemoryListSession },
  verb: BatchVerb,
  counts: LockableBatchCounts,
  lines: readonly BatchResultLine[]
): Promise<void> {
  const { succeeded, failed } = counts;
  const resultEmbed = buildBatchResultEmbed({
    title: verb === 'delete' ? '🗑️ Delete Results' : '🔐 Lock Results',
    color: batchResultColor({ succeeded, failed }),
    lines: formatBatchItemLines(lines),
  });

  const countsLine = formatLockableCountsLine(counts, verb === 'delete');

  // The refreshed view does session-manager round-trips that can throw AFTER
  // the mutations ran — a throw degrades to the result-only reply, never
  // loses the report.
  const viewPromise = (
    session.data.kind === 'browse'
      ? buildRefreshedBrowseView(interaction)
      : buildRefreshedSearchView(interaction)
  ).catch((error: unknown): null => {
    logger.warn({ err: error, verb }, 'Refreshed list view failed; reporting the result alone');
    return null;
  });

  await deliverBatchReport(interaction, { resultEmbed, viewPromise, countsLine, verb });
}

/**
 * Confirm verb — run the loop sequentially with per-item isolation, then
 * render a result embed naming every memory's outcome on top of the
 * kind-refreshed list view. The list session is resolved by the router and
 * passed in — it is the single source, and a gone session never reaches this
 * handler.
 */
export async function handleMemoryBatchConfirm(
  interaction: ButtonInteraction,
  verb: BatchVerb,
  session: { data: MemoryListSession }
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await ackUpdate(interaction);
  }

  const ids = parseBatchFooterIds(interaction.message.embeds[0]?.footer?.text);
  if (ids === null) {
    await followUpSpec(
      interaction,
      CATALOG.error.validation(
        "Couldn't tell which memories were selected — please run the command and try again."
      )
    );
    return;
  }

  const userId = interaction.user.id;
  const { userClient } = clientsFor(interaction);

  // Strip the confirm buttons to shrink the double-tap window to the ack +
  // strip round-trips themselves — a tap Discord delivers inside that window
  // still runs the whole flow (see multiSelectBatch.ts's second-tap note).
  // After the strip, later taps find nothing to act on. The embeds stay
  // untouched: the confirm view remains visible but inert. A refusal below
  // loses that inert view, and its followUp tells the user to re-run the
  // command — there is nothing left to retry on this message.
  await interaction.editReply({ components: [] });

  // Labels come from a fetch made BEFORE the loop: after it runs, the
  // successfully deleted memories are gone from the page and their real
  // content would be unrecoverable. The session itself was resolved by the
  // router (a gone session is refused there, before this handler runs); a
  // failed pre-loop page fetch refuses HERE, before any gateway mutation —
  // the outcome report could not name the memories it acted on.
  const resolved = await resolveBatchLabels(userClient, session, ids, userId);
  if (!resolved.ok) {
    // A live session with a failed fetch is NOT an expired session — but
    // nothing on this message is retryable either, so the copy asks for a
    // fresh run instead of a bare "try again later".
    await followUpSpec(
      interaction,
      CATALOG.error.validation("Couldn't load that page. Please run the command again.")
    );
    return;
  }
  const labels = resolved.labels;

  const lockedIds = new Set(
    [...labels.entries()].filter(([, meta]) => meta.isLocked === true).map(([id]) => id)
  );
  // A LOCK run must not re-send setMemoryLock(true) for an already-locked id
  // and report success: an id whose lock state could not be resolved (off the
  // page AND its per-id read failed) is failed upfront WITHOUT mutating. The
  // delete run needs no such guard — its 403 names locked ids honestly, and
  // a deleted id needs no lock state at all.
  const unverifiableIds = verb === 'lock' ? new Set(resolved.readErrors.keys()) : new Set<string>();
  // A gone id (its per-id read 404'd) skips the mutation for BOTH verbs: the
  // delete call would return false and the lock call null — the same
  // already-gone outcome, reached without the wasted gateway call.
  const runIds = ids.filter(
    id => !lockedIds.has(id) && !unverifiableIds.has(id) && !resolved.goneIds.has(id)
  );
  const results = await runBatchSequentially(runIds, id =>
    runBatchVerb(userClient, verb, id, userId)
  );

  // Same truncation the select menu applies to option labels — the result
  // lines must not resurrect the full content the menu clipped.
  const labelFor = (id: string): string =>
    escapeMarkdown(
      truncateForSelect(labels.get(id)?.label ?? fallbackMemoryLabel(id), { stripNewlines: true })
    );

  const runOptions = {
    destroying: verb === 'delete',
    nouns: MEMORY_BATCH_NOUNS,
  } satisfies LockableBatchRunOptions;
  const toResultLine = (result: (typeof results)[number]): BatchResultLine =>
    toLockableResultLine(result, labelFor(result.id), runOptions);

  // Original ids order: loop results where the id ran, upfront skips otherwise (see buildSkippedLockableLine).
  const resultLines = new Map<string, BatchResultLine>(
    results.map(result => [result.id, toResultLine(result)])
  );
  const skips = { goneIds: resolved.goneIds, lockedIds, readErrors: resolved.readErrors };
  const lines = ids.map(
    (id): BatchResultLine =>
      resultLines.get(id) ?? buildSkippedLockableLine(id, labelFor(id), skips, runOptions)
  );

  const counts = countLockableBatchLines(lines);
  logger.info({ userId, verb, requested: ids.length, ...counts }, 'Batch memory action finished');

  await deliverBatchResult(interaction, session, verb, counts, lines);
}
