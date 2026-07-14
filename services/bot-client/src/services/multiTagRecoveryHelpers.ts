/**
 * BullMQ state-polling invariants shared by the two moments a slot's job
 * state is read back from the queue instead of arriving as a live event:
 * `MultiTagRecovery` (boot-time rehydration) and `MultiTagCoordinator`'s
 * safety-timeout last-chance re-poll. All helpers here shape BullMQ job
 * state into the form `coordinator.handleJobResult` consumes.
 *
 * Separate from `multiTagCoordinatorHelpers.ts` (coordinator-time
 * invariants: `RuntimeSlot`, `RuntimeEntry`, snapshot projections)
 * because state-readback and live coordination are different phases.
 */

import type { Queue } from 'bullmq';
import { type LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('MultiTagRecoveryHelpers');

/**
 * Note on semantics: the per-slot counters (`slotsRecoveredCompleted`,
 * `slotsRecoveredFailed`, `slotsTrustedToStream`, `slotsUnrecoverable`) count
 * COMPUTED poll outcomes, not deliveries — an entry discarded by the age gate
 * still increments them for its slots. `entriesExpiredSilent` is a SUBSET of
 * `entriesDiscarded` (the gate's discard also bumps the generic counter).
 */
export interface RecoveryStats {
  entriesScanned: number;
  entriesResumed: number;
  entriesDiscarded: number;
  /** Slots whose old job was found completed; result delivered synthetically. */
  slotsRecoveredCompleted: number;
  /** Slots whose old job was found failed; error delivered synthetically. */
  slotsRecoveredFailed: number;
  /** Slots whose old job was still in flight; adopted as-is, stream will deliver. */
  slotsTrustedToStream: number;
  /**
   * Slots whose old job was evicted from Redis (or whose state poll
   * returned 'unknown'); error delivered synthetically because the result
   * is unrecoverable.
   */
  slotsUnrecoverable: number;
  slotsAccessRevoked: number;
  staleJobIdsMarked: number;
  /**
   * Entries older than the coordinator safety window with no recoverable
   * completed result — resolved silently at boot instead of adopting a
   * wedged group whose only possible outcome is a late synthetic error.
   */
  entriesExpiredSilent: number;
  /**
   * Slots that a prior recovery run already delivered (per the
   * `slot-delivered:{jobId}` marker written by `deliverSlot`). Skipped to
   * avoid duplicate user-visible delivery on a re-run after a crash
   * during `deliverGroup`'s post-Discord-send cleanup.
   */
  slotsAlreadyDelivered: number;
}

export interface DeferredDelivery {
  jobId: string;
  result: LLMGenerationResult;
  /**
   * Why this delivery exists — preserves the recovery-outcome category through
   * the deferred-dispatch loop. The per-entry log emits these as distinct
   * counters; operators diagnosing eviction frequency need to distinguish
   * `'unrecoverable'` from `'recoveredFailed'`, since both materialize as
   * `success: false` results that filtering on `result.success` alone would
   * collapse together.
   */
  kind: 'recoveredCompleted' | 'recoveredFailed' | 'unrecoverable';
}

/**
 * Outcome of polling BullMQ for a slot's job state at recovery time.
 * Discriminated union; consumers `switch` on `kind`.
 */
export type SlotStateOutcome =
  | { kind: 'completed'; result: LLMGenerationResult }
  | { kind: 'failed'; failedReason: string }
  | { kind: 'inFlight' }
  | { kind: 'unrecoverable' };

/**
 * Poll BullMQ for the authoritative state of a job that was pending at
 * snapshot time. Wraps `queue.getJob().getState()` with bounded error
 * handling — a transient Redis blip during recovery falls back to
 * "trust the stream" rather than failing the slot, so the live
 * subscription can still deliver once it's running.
 */
export async function pollPriorJobState(queue: Queue, jobId: string): Promise<SlotStateOutcome> {
  let job;
  try {
    job = await queue.getJob(jobId);
  } catch (err) {
    logger.warn({ err, jobId }, 'Recovery: queue.getJob threw — treating as in-flight');
    return { kind: 'inFlight' };
  }
  if (!job) {
    return { kind: 'unrecoverable' };
  }

  let state: string;
  try {
    state = await job.getState();
  } catch (err) {
    logger.warn({ err, jobId }, 'Recovery: job.getState threw — treating as in-flight');
    return { kind: 'inFlight' };
  }

  switch (state) {
    case 'completed':
      // Cast required because BullMQ's Job#returnvalue is typed `unknown`
      // at the generic-Queue level. The ai-worker handler's signature
      // (`Promise<LLMGenerationResult>` in LLMGenerationHandler.processJob)
      // guarantees this shape architecturally for jobs on the AI-requests
      // queue — but the contract isn't enforced at the boundary.
      //
      // **The most common runtime cause of `returnvalue === undefined`
      // here is BullMQ's `removeOnComplete: { count: N }` eviction
      // racing the `getState()`→`returnvalue` access window**: state
      // returns 'completed', then the job record is GC'd before we read
      // returnvalue. Worker crash between completion-write and
      // returnvalue-write is a possible but rarer cause. Operators
      // investigating non-zero `slotsUnrecoverable` on a healthy cluster
      // should check the queue's `removeOnComplete` retention first.
      //
      // Either way, route through the unrecoverable path so
      // coordinator.handleJobResult never receives a malformed result.
      if (job.returnvalue === null || job.returnvalue === undefined) {
        return { kind: 'unrecoverable' };
      }
      // Shape guard: defense-in-depth against an ai-worker contract
      // change (e.g., handler wraps the result in an envelope) or a
      // partially-written returnvalue from a multi-field-write crash.
      // The architectural guarantee is that handlers return
      // `LLMGenerationResult` (an object with `success`), so anything
      // that fails this check is unrecoverable — let the user see a
      // synthetic error instead of feeding `coordinator.handleJobResult`
      // a malformed value.
      if (typeof job.returnvalue !== 'object' || !('success' in job.returnvalue)) {
        return { kind: 'unrecoverable' };
      }
      return { kind: 'completed', result: job.returnvalue as LLMGenerationResult };
    case 'failed':
      return { kind: 'failed', failedReason: job.failedReason ?? 'Unknown failure' };
    case 'active':
    case 'waiting':
    case 'waiting-children':
    case 'delayed':
    case 'prioritized':
      return { kind: 'inFlight' };
    default:
      // 'unknown' or any future state BullMQ adds. Treat as unrecoverable
      // so the user gets a synthetic-error message instead of a silent
      // wait until the safety timeout fires.
      return { kind: 'unrecoverable' };
  }
}

/**
 * Build a synthetic `LLMGenerationResult` for slots whose job failed
 * (handler threw or job was evicted). The shape matches what
 * `coordinator.handleJobResult` expects on the failure branch — `success:
 * false` triggers the `'errored'` slot transition, and `error` is rendered
 * by the deliverError path.
 *
 * The `requestId` is set to the jobId so log correlation still works
 * across processes. `content` is omitted because the success-path consumer
 * wouldn't reach it anyway when `success === false`. The parameter is any
 * jobId carrier — both `SlotSnapshot` (recovery) and `RuntimeSlot`
 * (safety-timeout re-poll) satisfy it.
 */
export function synthesizeFailureResult(
  slot: { jobId: string },
  error: string
): LLMGenerationResult {
  return {
    requestId: slot.jobId,
    success: false,
    error,
  };
}

/**
 * Last-chance BullMQ re-poll for a group's pending slots, run when the
 * coordinator's safety timeout fires. A job that actually completed (or
 * failed with an authoritative reason) while its event was lost — the
 * listener-attach gap around a restart, a deploy-killed QueueEvents
 * subscription — delivers its REAL outcome through the supplied `deliver`
 * callback (the coordinator's `handleJobResult`); the synthetic timeout
 * error stays reserved for jobs that are genuinely still in flight or gone.
 * A `deliver` throw never aborts the sweep — remaining slots still get
 * their re-poll. The throwing slot keeps whatever state delivery reached:
 * `handleJobResult` marks the slot terminal with the real result before
 * its only internal throw point (the persistence write), so the result
 * still flushes with the group; only a slot left genuinely pending gets
 * the caller's synthetic path.
 */
export async function recoverRealResultsAtDeadline(
  queue: Queue,
  entry: { groupId: string; slots: readonly { jobId: string; status: string }[] },
  deliver: (jobId: string, result: LLMGenerationResult) => Promise<void>
): Promise<void> {
  const pendingSlots = entry.slots.filter(s => s.status === 'pending');
  for (const slot of pendingSlots) {
    const outcome = await pollPriorJobState(queue, slot.jobId);
    if (outcome.kind !== 'completed' && outcome.kind !== 'failed') {
      continue;
    }
    const result =
      outcome.kind === 'completed'
        ? outcome.result
        : synthesizeFailureResult(slot, outcome.failedReason);
    logger.info(
      { groupId: entry.groupId, jobId: slot.jobId, outcome: outcome.kind },
      'Safety-timeout re-poll found a real job outcome — delivering it instead of a synthetic timeout'
    );
    try {
      await deliver(slot.jobId, result);
    } catch (err) {
      logger.error(
        { err, groupId: entry.groupId, jobId: slot.jobId },
        'Safety-timeout re-poll delivery threw — continuing with remaining slots (slot keeps the state delivery reached; only a still-pending slot gets the synthetic path)'
      );
    }
  }
}
