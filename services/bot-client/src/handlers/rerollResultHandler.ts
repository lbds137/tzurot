/**
 * Reroll result delivery.
 *
 * A reroll's generation result is never posted as a new message and never goes
 * through the normal assistant persistence: it rewrites the old reply's Discord
 * messages in place and then asks the gateway to swap the history row and the
 * memories (commit). Every failure after generation asks the gateway to remove
 * the memories the new reply wrote (abort) and releases the per-row guard.
 *
 * Order, each step ending the run on failure:
 *  1. failed / empty result: ephemeral error only (nothing to undo unless the
 *     worker reported memory ids)
 *  2. re-run the preflight with the new memory ids excluded
 *  3. re-fetch the live chunks and resolve the edit target
 *  4. rebuild the footer from the NEW result and edit the chunks (text only:
 *     nothing is deleted and no attachment removed yet)
 *  5. commit
 *  6. after a landed commit: delete surplus chunks, clear stale attachments,
 *     success reply. After a commit that cannot land: put the old text back.
 */

import type { Client } from 'discord.js';
import type { Redis } from 'ioredis';
import {
  MAX_REPLY_CHUNKS,
  REROLL_MAX_CONTENT_LENGTH,
} from '@tzurot/common-types/constants/discord';
import { API_ERROR_SUBCODE } from '@tzurot/common-types/constants/error';
import { type LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { redis as defaultRedis } from '../redis.js';
import {
  deleteRerollJob,
  markRerollJobHandled,
  releaseRerollGuard,
  rerollJobHandledBy,
  takeRerollJob,
  type RerollJobRecord,
} from '../services/character/rerollGuard.js';
import {
  abortReroll,
  isDefiniteRefusal,
  type AbortOutcome,
} from '../services/character/rerollAbort.js';
import {
  REROLL_BOOT_ID,
  REROLL_INFLIGHT_MIN_AGE_MS,
  appendInflightExtra,
  buildInflightRecord,
  deleteInflight,
  peekInflight,
  writeInflight,
} from '../services/character/rerollInflight.js';
import { defaultSchedule, handOffToRecovery } from '../services/character/rerollRecovery.js';
import { CANT_REROLL_MESSAGE, type RerollPreflight } from '../services/character/rerollTurn.js';
import type { RerollJobContext } from '../services/JobTracker.js';
import { buildResponseFooter } from '../services/responseFooter.js';
import { buildErrorContent } from '../utils/buildErrorContent.js';
import { buildEditedChunks } from '../utils/editResponse/chunkPlan.js';
import {
  beginEditedChunks,
  finishEditedChunks,
  restoreEditedChunks,
  type BegunEdit,
} from '../utils/editResponse/discordEdit.js';
import { fetchLiveChunks, resolveTarget } from '../utils/editResponse/liveTarget.js';
import { rerollPreflightMessage } from '../utils/editResponse/rerollPreflight.js';
import { clientsForUser } from '../utils/gatewayClients.js';
import { updateDiagnosticResponseIds } from '../utils/gatewayServiceCalls.js';
import { buildResultMetadataPassthrough } from '../utils/resultMetadataPassthrough.js';
import { CATALOG } from '../ux/catalog/catalog.js';
import { replySpecSafe } from '../ux/render/reply.js';
import { buildCommitBody, reportedMemory } from './rerollCommitBody.js';

const logger = createLogger('reroll-result-handler');

// The catalog's success severity prepends the check mark.
export const REROLLED_MESSAGE = 'Response rerolled.';
export const PARTIAL_REROLLED_MESSAGE =
  "Response rerolled, but part of it couldn't be updated on Discord.";
export const NOT_LATEST_MESSAGE = "This reply is no longer the latest, so it can't be rerolled.";
export const GENERIC_FAILURE_MESSAGE = 'Something went wrong rerolling the response.';
export const TOO_LONG_MESSAGE = 'The new reply is too long to post, so the reroll was cancelled.';
export const SAVE_FAILED_MESSAGE =
  "The reply changed on Discord, but its history couldn't be updated.";
export const RESTORED_MESSAGE = "The reroll couldn't be saved, so the original reply was put back.";

export interface RerollResultDeps {
  redis: Redis;
  /** Run `fn` once after `delayMs`; injectable for tests. Defaults to recovery's unref'd timer. */
  schedule?: (fn: () => Promise<void>, delayMs: number) => void;
}

type Spec = ReturnType<typeof CATALOG.error.validation>;

function failure(message: string): Spec {
  return CATALOG.error.validation(message);
}

/** The refusal copy for a failed preflight re-check. */
function recheckFailureMessage(status: number, code: string | undefined): string {
  if (status === 409 && code === API_ERROR_SUBCODE.NOT_LATEST) {
    return NOT_LATEST_MESSAGE;
  }
  return CANT_REROLL_MESSAGE;
}

function plannedMemoryIds(preflight: RerollPreflight): string[] {
  return preflight.memoryPlan.kind === 'remove' ? preflight.memoryPlan.memoryIds : [];
}

type EditOutcome =
  | {
      ok: true;
      current: RerollPreflight;
      applied: BegunEdit;
      /** Put the pre-edit text back and delete the extras sent. Never throws; false when a step failed. */
      restore: (deferRecordDelete?: boolean) => Promise<boolean>;
      /** Delete the in-flight record: for a caller that restored with the delete deferred until its abort answered. */
      dropRecord: () => Promise<void>;
      /** After a landed commit: delete surplus chunks, clear stale attachments. Never throws. */
      finish: () => Promise<void>;
      /** The record stays (the run could not settle Discord): hand it to the recovery retry timer. */
      keep: () => void;
    }
  | {
      ok: false;
      message: string;
      /** Present when an in-flight record exists: delete it only after the abort the caller still owes has answered. */
      dropRecord?: () => Promise<void>;
    };

interface EditInPlaceArgs {
  jobId: string;
  redis: Redis;
  ctx: RerollJobContext;
  result: LLMGenerationResult;
  content: string;
}

/**
 * Steps 2-4: the world may have moved while the model ran, so re-run the
 * preflight with the new reply's memories excluded (so they are not read as the
 * old reply's), re-fetch the live chunks, then edit them. The footer describes
 * the NEW generation, so it is rebuilt from the result's metadata rather than
 * carried over from the old message.
 */
async function editInPlace(args: EditInPlaceArgs): Promise<EditOutcome> {
  const { ctx, result, content } = args;
  const { newMemoryIds, newPendingIds } = reportedMemory(result);
  const { interaction, preflight, rowId } = ctx;
  const { userClient } = clientsForUser(interaction.user);

  const recheck = await userClient.checkRerollAssistantMessage(preflight.discordMessageIds[0], {
    excludeMemoryIds: newMemoryIds,
    excludePendingIds: newPendingIds,
  });
  if (!recheck.ok) {
    return { ok: false, message: recheckFailureMessage(recheck.status, recheck.code) };
  }
  const current = recheck.data;
  if (current.rowId !== rowId) {
    return { ok: false, message: CANT_REROLL_MESSAGE };
  }
  const refusal = rerollPreflightMessage(current.memoryPlan);
  if (refusal !== null) {
    return { ok: false, message: refusal };
  }

  const live = await fetchLiveChunks(interaction.client, ctx.channel.id, current.discordMessageIds);
  const resolved =
    live === null
      ? null
      : await resolveTarget(live.channel, live.chunks, current.personalityId, ctx.channel.id);
  if (live === null || resolved === null) {
    return { ok: false, message: CANT_REROLL_MESSAGE };
  }

  const footer = buildResponseFooter(buildResultMetadataPassthrough(result));
  const newChunks = buildEditedChunks(content, resolved.dmPrefix, footer);
  if (newChunks.length > MAX_REPLY_CHUNKS) {
    return { ok: false, message: TOO_LONG_MESSAGE };
  }
  // The record a restart settles, written before the first byte changes on
  // Discord and kept current as extras are sent.
  const inflight = buildInflightRecord({
    jobId: args.jobId,
    rowId,
    attemptId: ctx.attemptId,
    actorId: interaction.user.id,
    routeKey: preflight.discordMessageIds[0],
    keepMemoryIds: plannedMemoryIds(preflight),
    newMemoryIds,
    newPendingIds,
    channelId: ctx.channel.id,
    personalityId: current.personalityId,
    rowContent: current.content,
    liveChunks: live.chunks,
    newChunkCount: newChunks.length,
  });
  const handOff = (): void =>
    handOffToRecovery({ client: interaction.client, redis: args.redis }, args.jobId);
  if (await writeInflight(args.redis, inflight)) {
    // The in-flight record now carries the repair, so the job record (what a
    // redelivery after a crash aborts from) is no longer needed. Before this
    // point it stays, so a crash in the earlier span is still aborted.
    await deleteRerollJob(args.redis, args.jobId);
  }
  let applied: Awaited<ReturnType<typeof beginEditedChunks>>;
  try {
    applied = await beginEditedChunks(resolved.target, live.chunks, newChunks, 'keep', messageId =>
      appendInflightExtra(args.redis, inflight, messageId)
    );
  } catch (err) {
    // A record may exist and the caller has no edit to repair from (`pending` is
    // still null there), so recovery's retry timer takes it.
    handOff();
    throw err;
  }
  if (!applied.ok) {
    // Nothing changed on Discord, so there is nothing for a restart to undo; the
    // record still goes only after the abort the caller owes (a crash in between
    // leaves it for recovery, whose abort is the one that cleans the memories).
    return {
      ok: false,
      message: applied.reason === 'uneditable' ? CANT_REROLL_MESSAGE : GENERIC_FAILURE_MESSAGE,
      dropRecord: () => deleteInflight(args.redis, args.jobId),
    };
  }
  const { target } = resolved;
  // The record goes once the repair it describes has run: a restore that
  // failed leaves it for the next boot, and so does a run that never reaches
  // either phase (an abort that could not say whether the commit landed).
  const keep = handOff;
  const dropRecord = (): Promise<void> => deleteInflight(args.redis, args.jobId);
  const restore = async (deferRecordDelete = false): Promise<boolean> => {
    const restored = await restoreEditedChunks(target, applied);
    if (!restored) {
      keep();
    } else if (!deferRecordDelete) {
      await dropRecord();
    }
    return restored;
  };
  const finish = async (): Promise<void> => {
    const finished = await finishEditedChunks(target, applied);
    await deleteInflight(args.redis, args.jobId);
    if (!finished.ok) {
      // A surplus chunk that could not be deleted still exists on Discord but is
      // not in the committed row's ids; no gateway route appends ids to a row.
      logger.warn(
        { rowId, survivorIds: finished.survivorIds },
        'Reroll left chunks behind after the commit (surplus delete or attachment clear failed)'
      );
    }
  };
  return { ok: true, current, applied, restore, dropRecord, finish, keep };
}

/**
 * A reroll result whose job the tracker no longer knows (a restart lost the
 * slot). The reply is not delivered, so the memories the worker wrote for it
 * are removed and the guard released. Returns false when the job was never a
 * reroll, leaving the caller's unknown-job handling to run.
 */
export async function handleUnknownRerollResult(
  jobId: string,
  result: LLMGenerationResult,
  client: Client,
  deps: RerollResultDeps = { redis: defaultRedis }
): Promise<boolean> {
  // The tracked path marks the job handled (boot id and time). A marker from
  // THIS boot means a live handler owns the job: a duplicate is left alone and
  // never reads as a loss.
  const handledBy = await rerollJobHandledBy(deps.redis, jobId);
  if (handledBy?.bootId === REROLL_BOOT_ID) {
    logger.info({ jobId }, 'Duplicate reroll result ignored (already being handled)');
    return true;
  }
  // A marker from another boot: that handler died OR, in a rolling overlap, is
  // still running. A young marker is not acted on yet: the decision is re-run
  // once it is old enough (the result is held in memory until then).
  if (handledBy !== null) {
    const waitMs = REROLL_INFLIGHT_MIN_AGE_MS - (Date.now() - handledBy.markedAt);
    if (waitMs > 0) {
      logger.info({ jobId }, 'Reroll result from another boot is young; rechecking later');
      (deps.schedule ?? defaultSchedule)(async () => {
        try {
          await handleUnknownRerollResult(jobId, result, client, deps);
        } catch (err) {
          logger.warn({ err, jobId }, 'Deferred reroll result recheck failed');
        }
      }, waitMs);
      return true;
    }
    // Past the minimum age: an in-flight record means restart recovery owns the repair.
    if ((await peekInflight(deps.redis, jobId)) !== null) {
      logger.info({ jobId }, 'Reroll result left to restart recovery (its handler died)');
      return true;
    }
  }
  // Claiming is atomic: of two unknown-path deliveries exactly one gets the
  // record. This path never writes the marker. A genuinely lost result (no
  // record, no marker) answers false. With another boot's marker, no in-flight
  // record and no job record the handler finished (or recovery has the record
  // claimed out): answered as handled, not as a loss.
  const record: RerollJobRecord | null = await takeRerollJob(deps.redis, jobId);
  if (record === null) {
    return handledBy !== null;
  }
  try {
    const { newMemoryIds, newPendingIds } = reportedMemory(result);
    const actor = await client.users.fetch(record.actorId).catch((err: unknown) => {
      logger.warn({ err, jobId, rowId: record.rowId }, 'Reroll actor could not be fetched');
      return null;
    });
    if (actor !== null) {
      await abortReroll({
        jobId,
        userClient: clientsForUser(actor).userClient,
        routeKey: record.routeKey,
        rowId: record.rowId,
        attemptId: record.attemptId,
        keepMemoryIds: record.keepMemoryIds,
        newMemoryIds,
        newPendingIds,
      });
    }
    logger.warn({ jobId, rowId: record.rowId }, 'Reroll result arrived for an untracked job');
  } finally {
    await releaseRerollGuard(deps.redis, record.rowId, record.attemptId);
  }
  return true;
}

interface SettleArgs {
  status: number;
  abort: () => Promise<AbortOutcome>;
  restore: (deferRecordDelete?: boolean) => Promise<boolean>;
  dropRecord: () => Promise<void>;
  /** Hand the kept record to recovery (the abort could not say whether the commit landed). */
  keep: () => void;
  interaction: RerollJobContext['interaction'];
}

/**
 * After a failed commit: true when the commit turns out to have landed (the
 * caller carries on to phase 2 and the success reply), false when the failure
 * was settled here with a reply. A definite refusal cannot land, so the old
 * text is restored first and the abort follows; anything else may have landed,
 * and the abort (which locks the row against the commit) says which.
 */
async function settleFailedCommit(args: SettleArgs): Promise<boolean> {
  const { status, abort, restore, dropRecord, keep, interaction } = args;
  const definite = isDefiniteRefusal(status);
  const outcome: AbortOutcome = definite ? 'aborted' : await abort();
  if (outcome === 'committed') {
    return true;
  }
  if (outcome === 'unknown') {
    keep();
    await replySpecSafe(interaction, failure(SAVE_FAILED_MESSAGE));
    return false;
  }
  // The commit can never land, so Discord must not keep text the history refused.
  // A definite refusal still owes its abort: the record outlives it, so a crash
  // between the restore and the abort leaves recovery to run it.
  const restored = await restore(definite);
  if (definite) {
    await abort();
    if (restored) {
      await dropRecord();
    }
  }
  await replySpecSafe(interaction, failure(restored ? RESTORED_MESSAGE : SAVE_FAILED_MESSAGE));
  return false;
}

/** After a throw mid-delivery: put Discord in line with what the abort learned. */
async function settleThrown(
  outcome: AbortOutcome,
  pending: Extract<EditOutcome, { ok: true }> | null
): Promise<void> {
  if (pending === null) {
    return;
  }
  if (outcome === 'aborted') {
    await pending.restore();
  } else if (outcome === 'committed') {
    await pending.finish();
  } else {
    pending.keep();
  }
}

/**
 * Deliver a reroll result. Never throws: the interaction replies are best
 * effort and the guard is released on every path.
 */
export async function handleRerollJobResult(
  jobId: string,
  result: LLMGenerationResult,
  ctx: RerollJobContext,
  deps: RerollResultDeps = { redis: defaultRedis }
): Promise<void> {
  const { interaction, preflight, rowId, attemptId } = ctx;
  const routeKey = preflight.discordMessageIds[0];
  const { userClient } = clientsForUser(interaction.user);
  const { newMemoryIds, newPendingIds } = reportedMemory(result);

  const abort = (): Promise<AbortOutcome> =>
    abortReroll({
      jobId,
      userClient,
      routeKey,
      rowId,
      attemptId,
      keepMemoryIds: plannedMemoryIds(preflight),
      newMemoryIds,
      newPendingIds,
    });

  /** Abort the attempt, then tell the user why. */
  const abortAndReply = async (
    message: string,
    dropRecord?: () => Promise<void>
  ): Promise<void> => {
    await abort();
    await dropRecord?.();
    await replySpecSafe(interaction, failure(message));
  };

  // Mark the job handled before any gateway call: a same-boot duplicate
  // delivery of this result finds the marker and can neither abort the attempt
  // this run is committing nor be reported as a loss. The job record is NOT
  // taken here: it goes once the in-flight record exists (`editInPlace`) or
  // when this run ends, so a crash before then is still aborted on redelivery.
  await markRerollJobHandled(deps.redis, jobId);
  let pending: Extract<EditOutcome, { ok: true }> | null = null;

  try {
    // 1. A failed or empty generation: no Discord change, no commit.
    const content = result.content;
    if (result.success === false || typeof content !== 'string' || content.length === 0) {
      logger.error({ jobId, rowId, error: result.error }, 'Reroll generation failed');
      if (newMemoryIds.length > 0 || newPendingIds.length > 0) {
        await abort();
      }
      await replySpecSafe(interaction, failure(buildErrorContent(result)));
      return;
    }
    if (content.length > REROLL_MAX_CONTENT_LENGTH) {
      await abortAndReply(TOO_LONG_MESSAGE);
      return;
    }

    // 2-4. Re-check, then rewrite the Discord chunks in place.
    const edited = await editInPlace({ jobId, redis: deps.redis, ctx, result, content });
    if (!edited.ok) {
      await abortAndReply(edited.message, edited.dropRecord);
      return;
    }
    pending = edited;
    const { current, applied, restore, dropRecord, finish, keep } = edited;

    // 5. Commit: the first stored chunk is never deleted, so it stays a valid route key.
    const committed = await userClient.rerollAssistantMessage(
      routeKey,
      buildCommitBody({ jobId, ctx, result, current, content, applied })
    );
    if (!committed.ok) {
      logger.warn(
        { jobId, rowId, status: committed.status, code: committed.code },
        'Discord rerolled but the history commit failed'
      );
      const landed = await settleFailedCommit({
        status: committed.status,
        abort,
        restore,
        dropRecord,
        keep,
        interaction,
      });
      if (!landed) {
        return;
      }
    }
    await finish();

    // 6. Success.
    void updateDiagnosticResponseIds(result.requestId, applied.messageIds).catch(err => {
      logger.warn({ err }, 'Failed to update diagnostic response IDs (reroll)');
    });
    logger.info(
      {
        jobId,
        rowId,
        chunks: applied.messageIds.length,
        partial: applied.partial,
        removedMemories: committed.ok ? committed.data.removedMemories : undefined,
      },
      'Reroll delivered'
    );
    await replySpecSafe(
      interaction,
      CATALOG.success.done(applied.partial ? PARTIAL_REROLLED_MESSAGE : REROLLED_MESSAGE)
    );
  } catch (err) {
    logger.error({ err, jobId, rowId }, 'Reroll delivery failed');
    await settleThrown(await abort(), pending);
    await replySpecSafe(interaction, failure(GENERIC_FAILURE_MESSAGE));
  } finally {
    // Every exit ends the attempt here (a failed or too-long result, an early
    // abort, a throw, or a finished run), so the job record has nothing left to
    // abort from. A repair still owed is on the in-flight record.
    await deleteRerollJob(deps.redis, jobId);
    await releaseRerollGuard(deps.redis, rowId, attemptId);
  }
}
