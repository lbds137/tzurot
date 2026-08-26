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
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { confirmDelivery } from '../utils/gatewayServiceCalls.js';
import type {
  CoordinatorEntrySnapshot,
  MultiTagPersistence,
  SlotSnapshot,
} from './MultiTagPersistence.js';
import type { RuntimeSlot } from './multiTagCoordinatorHelpers.js';

const logger = createLogger('MultiTagRecoveryHelpers');

/**
 * Build a minimal LoadedPersonality-shaped object for slots whose
 * personality is no longer accessible. The deliverError path uses
 * .displayName / .id / .slug / .name; this preserves those fields from
 * the snapshot so the user's error message identifies the right character.
 *
 * **Type-safety caveat**: the `as unknown as LoadedPersonality` cast
 * bypasses TypeScript. Downstream code that touches any field beyond
 * the four set here (e.g., `llmConfig`, `systemPrompt`, etc.) will
 * silently observe `undefined` rather than receive a type error. If a
 * future refactor changes deliverError to access additional
 * LoadedPersonality fields, this sentinel must be extended accordingly.
 * A typed `Partial<LoadedPersonality>` + a discriminated-union sentinel
 * shape would be cleaner; tracked as TASK-98.
 */
export function buildSentinelPersonality(slotSnap: SlotSnapshot): LoadedPersonality {
  return {
    id: slotSnap.personalityId,
    slug: slotSnap.personalitySlug,
    displayName: slotSnap.personalitySlug,
    name: slotSnap.personalitySlug,
  } as unknown as LoadedPersonality;
}

/**
 * Note on semantics: the four per-slot outcome counters
 * (`slotsRecoveredCompleted`, `slotsRecoveredFailed`, `slotsTrustedToStream`,
 * `slotsUnrecoverable`) are SURVIVOR counts, disjoint from
 * `slotsAlreadyDelivered` — a slot a prior run already sent is counted only in
 * `slotsAlreadyDelivered`, never also under the poll outcome that produced its
 * (now-dropped) delivery. They still count slots of an entry the age gate went
 * on to discard: the counters describe what the poll+marker pass RESOLVED, not
 * what was ultimately dispatched. `entriesExpiredSilent` is a SUBSET of
 * `entriesDiscarded` (the gate's discard also bumps the generic counter).
 *
 * The disjointness is structural: `tallyEntrySlots` is the single site that
 * derives all five, from the post-marker-pass delivery list, and it adds into
 * `stats` and returns the same object in one step. Only a REHYDRATED entry
 * logs that object (`'Multi-tag entry rehydrated'`); an entry that goes on to
 * take a discard path has already contributed its counts, and
 * `'Multi-tag entry discarded during recovery'` carries no per-slot breakdown
 * — so the run-level aggregate is not reconcilable against the per-entry logs
 * alone. Pinned by
 * "counts an already-delivered slot only once, under slotsAlreadyDelivered" in
 * `MultiTagRecovery.test.ts`.
 */
export interface RecoveryStats {
  entriesScanned: number;
  entriesResumed: number;
  entriesDiscarded: number;
  /**
   * Slots whose old job was found completed AND whose result had not already
   * been sent by the prior run; result delivered synthetically.
   */
  slotsRecoveredCompleted: number;
  /**
   * Slots whose old job was found failed AND whose error had not already been
   * sent by the prior run; error delivered synthetically.
   */
  slotsRecoveredFailed: number;
  /**
   * Slots whose old job was still in flight AND whose result had not already
   * been sent by the prior run; adopted as-is, stream will deliver.
   */
  slotsTrustedToStream: number;
  /**
   * Slots whose old job was evicted from Redis (or whose state poll
   * returned 'unknown') and whose synthetic error had not already been sent by
   * the prior run; error delivered synthetically because the result is
   * unrecoverable.
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
   * Slots a prior run already delivered (per the `slot-delivered:{jobId}`
   * marker written by `deliverSlot`). When a sibling can still produce output
   * they enter the rehydrated entry in a terminal state and are skipped at
   * flush; when every slot is delivered the entry is discarded instead. Either
   * way a crash during `deliverGroup`'s post-Discord-send cleanup produces
   * neither a duplicate message nor a later synthetic timeout for an
   * already-answered slot.
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

/** Result of the already-delivered pass over a rehydrated entry's slots. */
export interface AlreadyDeliveredPass {
  /**
   * The deferred deliveries still worth dispatching — every delivery whose
   * slot a prior run already sent has been dropped.
   */
  remainingDeliveries: DeferredDelivery[];
  /** How many slots a prior run had already delivered. */
  alreadyDeliveredCount: number;
  /**
   * How many of those were `'pending'` with no deferred delivery — exactly the
   * shape `buildRuntimeSlots` counted as trusted-to-stream. The caller subtracts
   * this from its pre-pass count so a slot whose marker resolved true reports
   * under `slotsAlreadyDelivered` alone. Pinned by "reports a delivered
   * no-delivery pending slot under deliveredTrustedToStreamCount" in
   * `multiTagRecoveryHelpers.test.ts`.
   */
  deliveredTrustedToStreamCount: number;
}

/**
 * Reconcile a rehydrated entry's slots against the `slot-delivered:{jobId}`
 * markers a prior process wrote after each successful Discord send.
 *
 * **Why this runs BEFORE the entry is built**, not during the deferred-delivery
 * dispatch that follows adoption: skipping the dispatch alone leaves the slot
 * sitting at `'pending'` in the rehydrated entry, and the re-armed safety timer
 * covers pending slots. The group then flushes a synthetic in-character timeout
 * long after the user already received the real reply. Marking the slot terminal
 * here is what keeps the safety timer scoped to slots that can still produce
 * output.
 *
 * **Every slot gets the lookup, including a `'pending'` one carrying no deferred
 * delivery.** That shape looks like a job still in flight, but it is also what an
 * ERROR during the state poll produces: `pollPriorJobState` reports `inFlight`
 * when `queue.getJob` or `job.getState` throws, so a job that completed and was
 * delivered by the prior run lands here whenever the poll hits a Redis blip —
 * and recovery runs at boot, right after the Redis connection is re-established.
 * The marker is the only thing that can tell those two apart, so the round-trip
 * is spent unconditionally: one Redis GET per slot, once per process, against a
 * synthetic in-character error sent to a user who already has the real reply.
 * Pinned by "cleans up a delivered slot whose state poll THREW" in
 * `MultiTagRecovery.test.ts`.
 *
 * A delivered slot with no deferred delivery gets `'completed'` — the status only
 * has to move it out of the safety timer's pending set, since `deliverSlot`
 * skips any slot carrying `alreadyDelivered` and nothing re-sends it. Whether the
 * original job succeeded or failed is unknowable here; what the marker attests is
 * that its message reached Discord. Pinned by "gives a delivered pending slot a
 * terminal status so the safety timer cannot cover it" in
 * `multiTagRecoveryHelpers.test.ts`.
 *
 * Mutates the slots in place (status + `alreadyDelivered`) and returns the
 * filtered delivery list; the caller owns the entry-level decision of whether
 * anything is left to rehydrate.
 */
export async function applyAlreadyDeliveredMarkers(
  slots: RuntimeSlot[],
  deferredDeliveries: DeferredDelivery[],
  isSlotDelivered: (jobId: string) => Promise<boolean>
): Promise<AlreadyDeliveredPass> {
  const deliveryByJobId = new Map(deferredDeliveries.map(d => [d.jobId, d]));
  const deliveredJobIds = new Set<string>();
  let deliveredTrustedToStreamCount = 0;
  // Sequential on purpose, unlike `discardRecoveredEntry`'s parallel confirm
  // fan-out: this loop mutates each slot and a shared counter as it goes, and a
  // group's slot count is bounded by the admin tag cap. Recovery is a rare,
  // deliberately sequential boot path — the round-trips are not worth the
  // restructuring a fan-out would need here. Not a correctness constraint:
  // `isSlotDelivered` fails closed on Redis errors, so a fan-out would be safe
  // too; this is about the shared-counter ergonomics only.
  for (const slot of slots) {
    const deferred = deliveryByJobId.get(slot.jobId);
    if (!(await isSlotDelivered(slot.jobId))) {
      continue;
    }
    slot.alreadyDelivered = true;
    if (deferred !== undefined) {
      // The transition handleJobResult would have applied, applied here
      // instead — the deferred delivery is about to be dropped, so nothing
      // else will move this slot off 'pending'.
      slot.status = deferred.kind === 'recoveredCompleted' ? 'completed' : 'errored';
    } else if (slot.status === 'pending') {
      // No delivery to infer an outcome from (the state poll failed, or the
      // job read as in-flight). Terminal is what matters: leaving it pending
      // hands it back to the safety timer, which is the bug this pass exists
      // to close. See the outcome discussion in the doc comment above.
      slot.status = 'completed';
      deliveredTrustedToStreamCount++;
    }
    // Per-slot, at debug: the aggregate counters say HOW MANY were skipped, and
    // correlating a user's "I got an error after the real reply" report needs
    // WHICH jobId. The equivalent line used to sit in the post-adoption dispatch
    // loop this pass replaced; it is what identified the original incident.
    // Debug rather than info so a boot resolving many entries stays readable.
    logger.debug(
      { jobId: slot.jobId, slotIndex: slot.slotIndex, status: slot.status },
      'Recovery: slot already delivered by a prior run — skipping dispatch'
    );
    deliveredJobIds.add(slot.jobId);
  }
  return {
    remainingDeliveries: deferredDeliveries.filter(d => !deliveredJobIds.has(d.jobId)),
    alreadyDeliveredCount: deliveredJobIds.size,
    deliveredTrustedToStreamCount,
  };
}

/** One entry's contribution to the per-slot counters in `RecoveryStats`. */
export interface EntrySlotCounts {
  slotsRecoveredCompleted: number;
  slotsRecoveredFailed: number;
  slotsUnrecoverable: number;
  slotsTrustedToStream: number;
  slotsAlreadyDelivered: number;
}

/**
 * Derive one entry's per-slot counters from the SURVIVING deliveries — the
 * list `applyAlreadyDeliveredMarkers` returns, with every already-sent slot
 * removed — add them into the run-level `stats`, and return them for the
 * caller's per-entry log.
 *
 * Deriving them here rather than at poll time is what keeps the five counters
 * disjoint: a slot whose marker resolved true is dropped from
 * `remainingDeliveries` and shows up under `slotsAlreadyDelivered` alone,
 * instead of also under the poll outcome that produced its delivery. Doing the
 * accumulation and the return in one step is what keeps a rehydrated entry's
 * logged counts and its contribution to the aggregate from drifting apart —
 * they are the same numbers. An entry that is discarded after this call still
 * contributes, without logging a breakdown of its own.
 *
 * `trustedToStreamCount` needs the same filtering, applied by the CALLER before
 * it reaches this function: a slot counted as trusted-to-stream is `'pending'`
 * with no deferred delivery, and the marker pass looks that shape up like any
 * other, so it CAN come back already-delivered. The caller subtracts
 * `AlreadyDeliveredPass.deliveredTrustedToStreamCount` from its pre-pass count.
 * This function trusts the number it is handed.
 */
export function tallyEntrySlots(
  stats: RecoveryStats,
  remainingDeliveries: DeferredDelivery[],
  trustedToStreamCount: number,
  alreadyDeliveredCount: number
): EntrySlotCounts {
  const counts: EntrySlotCounts = {
    slotsRecoveredCompleted: remainingDeliveries.filter(d => d.kind === 'recoveredCompleted')
      .length,
    slotsRecoveredFailed: remainingDeliveries.filter(d => d.kind === 'recoveredFailed').length,
    slotsUnrecoverable: remainingDeliveries.filter(d => d.kind === 'unrecoverable').length,
    slotsTrustedToStream: trustedToStreamCount,
    slotsAlreadyDelivered: alreadyDeliveredCount,
  };
  stats.slotsRecoveredCompleted += counts.slotsRecoveredCompleted;
  stats.slotsRecoveredFailed += counts.slotsRecoveredFailed;
  stats.slotsUnrecoverable += counts.slotsUnrecoverable;
  stats.slotsTrustedToStream += counts.slotsTrustedToStream;
  stats.slotsAlreadyDelivered += counts.slotsAlreadyDelivered;
  return counts;
}

/** What one entry's slot-rebuild pass produced. */
export interface RebuiltEntrySlots {
  runtimeSlots: RuntimeSlot[];
  deferredDeliveries: DeferredDelivery[];
  /**
   * Slots whose outcome was `inFlight` — a pending base slot with no deferred
   * delivery. Tracked during the loop rather than re-derived from
   * `runtimeSlots` afterwards, which would be load-bearing on the coordinator
   * mutating slot objects in place when it delivers.
   *
   * This is the PRE-marker-pass count: the pass can still find a marker for one
   * of these (an error during the state poll also reads as `inFlight`), so the
   * caller nets out `AlreadyDeliveredPass.deliveredTrustedToStreamCount` before
   * reporting it.
   */
  trustedToStreamCount: number;
}

/**
 * Rebuild every slot of one snapshot, collecting the runtime slots, the
 * deliveries to dispatch after adoption, and the trusted-to-stream count.
 * `rebuild` is the caller's per-slot policy (BullMQ state poll + personality
 * lookup); this function owns only the accumulation.
 */
export async function buildRuntimeSlots(
  slotSnaps: readonly SlotSnapshot[],
  rebuild: (
    slotSnap: SlotSnapshot
  ) => Promise<{ slot: RuntimeSlot; deferredDelivery?: DeferredDelivery }>
): Promise<RebuiltEntrySlots> {
  const runtimeSlots: RuntimeSlot[] = [];
  const deferredDeliveries: DeferredDelivery[] = [];
  let trustedToStreamCount = 0;
  for (const slotSnap of slotSnaps) {
    const { slot, deferredDelivery } = await rebuild(slotSnap);
    runtimeSlots.push(slot);
    if (deferredDelivery !== undefined) {
      deferredDeliveries.push(deferredDelivery);
    } else if (slot.status === 'pending') {
      trustedToStreamCount++;
    }
  }
  return { runtimeSlots, deferredDeliveries, trustedToStreamCount };
}

/**
 * Dispatch a rehydrated entry's surviving deferred deliveries through
 * `deliver` (the coordinator's `handleJobResult`), one at a time.
 *
 * Per-delivery try/catch: a throw from one delivery must not block the ones
 * after it. The narrow failure shape today is `handleJobResult` throwing on
 * its inner `updateEntry` persistence write (the handler is otherwise robust),
 * but the cost of the guard is negligible and the resilience matches the
 * per-slot catch in `multiTagDeliveryFlow.deliverSlot`.
 */
export async function dispatchDeferredDeliveries(
  groupId: string,
  deliveries: readonly DeferredDelivery[],
  deliver: (jobId: string, result: LLMGenerationResult) => Promise<void>
): Promise<void> {
  for (const delivery of deliveries) {
    try {
      await deliver(delivery.jobId, delivery.result);
    } catch (err) {
      logger.error(
        { err, jobId: delivery.jobId, groupId, kind: delivery.kind },
        'Recovery: deferred-delivery dispatch threw — continuing with remaining slots'
      );
    }
  }
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

export interface DiscardEntryOptions {
  /** Only the two persistence calls a discard makes. */
  persistence: Pick<MultiTagPersistence, 'markStale' | 'deleteEntry'>;
  snapshot: CoordinatorEntrySnapshot;
  /** Why the entry is being discarded; emitted on the discard log line. */
  reason: string;
  stats: RecoveryStats;
  /**
   * jobIds of slots a PRIOR run genuinely sent to Discord — the only ones this
   * function confirms. The caller derives it from `RuntimeSlot.alreadyDelivered`,
   * which `applyAlreadyDeliveredMarkers` sets only when `isSlotDelivered`
   * returned true, so a slot that was never sent cannot appear here.
   */
  deliveredJobIds: readonly string[];
}

/**
 * Discard an unrecoverable entry: mark every pending jobId stale (so
 * post-recovery arrivals are dropped), confirm delivery for the slots a prior
 * run genuinely sent, then delete the Redis snapshot. Best-effort throughout —
 * every step logs on failure instead of throwing.
 *
 * **Why the confirm belongs here**: an adopted entry reaches `deliverGroup`,
 * whose own fan-out flips each slot's gateway `job_results` row from
 * `PENDING_DELIVERY` to `DELIVERED`. Every discard path bypasses
 * `deliverGroup`, and the ai-worker cleanup job deletes only `DELIVERED` rows
 * (`CleanupJobResults.cleanupOldJobResults`), so a discarded entry's
 * already-delivered slot would otherwise leave a row nothing ever reclaims.
 */
export async function discardRecoveredEntry(opts: DiscardEntryOptions): Promise<void> {
  const { persistence, snapshot, reason, stats, deliveredJobIds } = opts;
  // These two lists read as if they should be disjoint, and are not. This one
  // comes from the PERSISTED snapshot status; `deliveredJobIds` comes from the
  // runtime-reconciled marker. In the very crash this recovery path exists for,
  // the snapshot never got its status write, so an already-delivered slot is
  // still 'pending' on disk and appears in both. Harmless: marking a job stale
  // only tells a late arrival to drop itself, and nothing will arrive for a job
  // that already completed and delivered.
  const pendingJobIds = snapshot.slots.filter(s => s.status === 'pending').map(s => s.jobId);
  if (pendingJobIds.length > 0) {
    try {
      await persistence.markStale(...pendingJobIds);
      stats.staleJobIdsMarked += pendingJobIds.length;
    } catch (err) {
      logger.warn(
        { err, groupId: snapshot.groupId },
        'Recovery: failed to mark stale during entry discard'
      );
    }
  }
  // Mirrors `deliverGroup`'s fan-out shape: parallel, each call catching and
  // logging its own failure. `confirmDelivery` is itself best-effort and never
  // throws, so nothing here can abort a discard.
  await Promise.all(
    deliveredJobIds.map(jobId =>
      confirmDelivery(jobId).catch(err => {
        logger.warn(
          { err, jobId, groupId: snapshot.groupId },
          'confirmDelivery failed for an already-delivered slot during entry discard'
        );
      })
    )
  );
  try {
    await persistence.deleteEntry(snapshot);
  } catch (err) {
    logger.warn({ err, groupId: snapshot.groupId }, 'Recovery: failed to delete discarded entry');
  }
  stats.entriesDiscarded++;
  logger.info(
    { groupId: snapshot.groupId, channelId: snapshot.channelId, reason },
    'Multi-tag entry discarded during recovery'
  );
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
