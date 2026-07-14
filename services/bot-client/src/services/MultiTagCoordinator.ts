/**
 * MultiTagCoordinator — orchestrates the multi-tag fan-out flow.
 *
 * For a single triggering message, fans N AI jobs out in parallel and
 * waits for all to complete before delivering responses in slot order
 * as an atomic burst to Discord.
 *
 * Lifecycle (happy path):
 *   1. PersonalityTriggerProcessor resolves slots and calls startFanOut.
 *   2. Coordinator submits N jobs via PersonalityChatManager, persists the
 *      entry to Redis, registers a group entry with ResponseOrderingService,
 *      and arms a safety-net timeout.
 *   3. As each result arrives, MessageHandler routes to handleJobResult
 *      (via the ownsJob check). Coordinator buffers, updates Redis.
 *   4. When all slots are non-pending, flushEntry delivers them in slot
 *      order via SlotDeliveryService, persists assistant messages, then
 *      tears down (Redis entry deleted, in-memory state cleared, timeout
 *      cancelled).
 *
 * Restart contract: in-memory state is volatile. On graceful shutdown, all
 * pending slot jobIds are added to a Redis stale set. Post-restart, results
 * arriving for those jobIds are discarded by the MessageHandler stale check
 * (confirmDelivery is still called so the Redis stream entry clears).
 * MultiTagRecovery scans the persisted entries on startup, polls BullMQ for
 * each pending slot's authoritative job state, and adopts the entries back
 * into this coordinator — so user-facing experience after a
 * restart-mid-fan-out is "responses arrive a bit later" rather than "no
 * response, please retry."
 */

import { randomUUID } from 'node:crypto';
import type { Message } from 'discord.js';
import type { Queue } from 'bullmq';
import { ApiErrorCategory, ApiErrorType } from '@tzurot/common-types/constants/error';
import { MULTI_TAG } from '@tzurot/common-types/constants/message';
import { type TypingChannel } from '@tzurot/common-types/types/discord-types';
import { type LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { PersonalityChatManager } from './character/PersonalityChatManager.js';
import type { JobTracker } from './JobTracker.js';
import type { ResponseOrderingService } from './ResponseOrderingService.js';
import type { SlotDeliveryService } from './SlotDeliveryService.js';
import type { MultiTagPersistence, SyntheticTimeoutContext } from './MultiTagPersistence.js';
import { type ResolvedSlot, type SlotSource } from './SlotResolver.js';
import { recoverRealResultsAtDeadline } from './multiTagRecoveryHelpers.js';

const logger = createLogger('MultiTagCoordinator');

// `RuntimeSlot` and `RuntimeEntry` shapes plus the `buildSlotContext` /
// `toSnapshot` projections live in a sibling file so this orchestrator
// stays under the `max-lines` cap and the projections are unit-testable
// independently.
export type { RuntimeEntry, RuntimeSlot } from './multiTagCoordinatorHelpers.js';
import {
  buildSyntheticErrorResult,
  toSnapshot,
  type RuntimeEntry,
  type RuntimeSlot,
} from './multiTagCoordinatorHelpers.js';
import { deliverGroup, deliverAllFailedNotice } from './multiTagDeliveryFlow.js';

/** Input shape for startFanOut — what PersonalityTriggerProcessor builds. */
export interface StartFanOutInput {
  message: Message;
  channel: TypingChannel;
  /** Slots already resolved (deduped, ordered, capped) by SlotResolver. */
  slots: ResolvedSlot[];
  /** Raw effective content to pass to each slot's AI submission. */
  content: string;
  /**
   * `true` if the resolver's cap dropped at least one tagged personality
   * (more unique candidates than `MAX_TAGS`). Surfaced as a one-line notice
   * after the slot-delivery burst so users see why fewer characters
   * responded than they tagged. Dedup-driven shrinkage (same character
   * tagged twice) doesn't count — caller decides.
   */
  truncated: boolean;
}

export interface MultiTagCoordinatorDeps {
  chatManager: PersonalityChatManager;
  jobTracker: JobTracker;
  orderingService: ResponseOrderingService;
  slotDelivery: SlotDeliveryService;
  persistence: MultiTagPersistence;
  /**
   * BullMQ queue handle for the AI-requests queue. Used by the safety
   * timeout's last-chance re-poll: before synthesizing a timeout error for
   * a still-pending slot, the coordinator checks the job's authoritative
   * state — a completed or failed job whose event was lost (listener-attach
   * gap around a restart, deploy-killed QueueEvents) delivers its REAL
   * result instead. Shared with MultiTagRecovery's boot-time state poll.
   */
  queue: Queue;
}

export class MultiTagCoordinator {
  private readonly entries = new Map<string, RuntimeEntry>();
  /** Reverse index: jobId → groupId. Updated on every slot submission/resume. */
  private readonly jobToGroup = new Map<string, string>();
  /**
   * Groups whose flush is currently in flight. Guards `flushEntry` against
   * double-invocation:
   *
   *   1. Concurrent same-process stream arrivals — two slot results landing
   *      before either's `await persistence.updateEntry` completes, both
   *      observing `allDone === true`. Without this guard, both would call
   *      flushEntry → double-delivery.
   *   2. Timer-race: safety-timeout fires after the last slot's
   *      handleJobResult began flushing but before `entries.delete` ran.
   *   3. Future recovery paths (follow-up PR) that may re-enter flushEntry
   *      for an already-flushing group.
   */
  private readonly flushingGroups = new Set<string>();
  private shuttingDown = false;
  /**
   * Whether any jobId has been marked stale during this process's lifetime
   * (via `beginShutdown` or `markStaleFromRecovery`). Gates the
   * `isStale` Redis SISMEMBER fast-path: if no shutdown has produced stale
   * jobIds, every regular single-personality result would otherwise pay a
   * pointless Redis roundtrip per arrival. Recovery on startup also flips
   * this — recovery marks the pre-restart jobIds stale.
   */
  private hasMarkedStale = false;

  constructor(private readonly deps: MultiTagCoordinatorDeps) {}

  /**
   * Submit AI jobs for every slot, persist coordinator state, and arm the
   * group-level ordering-service entry. Returns once submission is in flight;
   * results arrive asynchronously via handleJobResult.
   */
  async startFanOut(input: StartFanOutInput): Promise<void> {
    if (this.shuttingDown) {
      logger.warn(
        { sourceMessageId: input.message.id, slotCount: input.slots.length },
        'Refusing fan-out — coordinator is shutting down'
      );
      return;
    }
    if (input.slots.length === 0) {
      return;
    }

    // groupId is an internal coordinator token (Redis key suffix, ordering
    // service entry, jobId reverse-index value) — never a Discord-facing
    // identifier and never persisted across `channel_settings`. Non-
    // deterministic UUID is correct here; the deterministic-ID rule in
    // 00-critical.md applies to entity IDs that need to be reconstructible
    // from inputs.
    const groupId = randomUUID();
    const userMessageTime = new Date();

    // Submit N jobs in parallel. Each submission collapses to a denied slot
    // (gates / NSFW) or a submitted slot with a jobId.
    const slotSubmissions = await Promise.all(
      input.slots.map(async resolved => this.submitSlot(input, resolved))
    );

    // Dense slot indices: denied slots are skipped, surviving slots get
    // 0..k-1. The ResolvedSlot input may have had non-contiguous "logical"
    // positions (e.g., reply at 0, denied activation at 1, mention at 2 →
    // dense becomes [0:reply, 1:mention]). Recovery uses the snapshot's
    // dense `slotIndex` directly when rehydrating and never re-resolves
    // from input — so the indices are stable across the entry's lifetime
    // and the dense numbering is the canonical view.
    const runtimeSlots: RuntimeSlot[] = [];
    let nextIndex = 0;
    // Collect errored outcomes (personality + classified spec) so the
    // all-errored branch can deliver each character's own error voice.
    // Denied outcomes need no accumulation — they render as a single system
    // notice only when the WHOLE batch is denied.
    const erroredOutcomes: Extract<SlotOutcome, { kind: 'errored' }>[] = [];
    for (const submission of slotSubmissions) {
      if (submission.kind !== 'submitted') {
        if (submission.kind === 'errored') {
          erroredOutcomes.push(submission);
        }
        continue;
      }
      runtimeSlots.push({
        slotIndex: nextIndex++,
        personality: submission.personality,
        personaId: submission.personaId,
        source: submission.source,
        isAutoResponse: submission.isAutoResponse,
        jobId: submission.jobId,
        status: 'pending',
      });
    }

    if (runtimeSlots.length === 0) {
      await deliverAllFailedNotice(
        { message: input.message, channel: input.channel },
        erroredOutcomes,
        this.deps
      );
      return;
    }

    const timeoutHandle = setTimeout(() => {
      void this.handleSafetyTimeout(groupId).catch(err => {
        logger.error({ err, groupId }, 'Safety timeout handler threw unexpectedly');
      });
    }, MULTI_TAG.COORDINATOR_TIMEOUT_MS);

    const entry: RuntimeEntry = {
      groupId,
      sourceMessageId: input.message.id,
      message: input.message,
      channel: input.channel,
      guildId: input.message.guildId,
      clientId: input.message.client.user?.id,
      userId: input.message.author.id,
      userMessageTime,
      userMessageContent: input.content,
      slots: runtimeSlots,
      createdAt: Date.now(),
      timeoutHandle,
      truncated: input.truncated,
    };

    // Populate in-memory ownership BEFORE the persistence roundtrip.
    //
    // Why: between `Promise.all(submitSlot)` completing and the
    // `entries`/`jobToGroup` writes below, an AI response could in theory
    // arrive (very fast local cache hit, or a job result re-queued from a
    // previous bot session). Before this reorder, that result would find
    // `ownsJob` false, the stale check false, and `jobTracker.getContext`
    // populated (submitSlot registered it) — falling through to the
    // single-personality path and bypassing slot ordering for the whole
    // fan-out. After the reorder, `ownsJob` flips true the instant the
    // slot jobIds exist, so the result correctly buffers in the coordinator.
    //
    // The trade: if `putEntry` fails, the in-memory state is rolled back
    // (and the existing per-slot orderingService.registerJob degradation
    // kicks in). This means in-memory state is the "primary" ownership view
    // and Redis is the durable view — the inverse of "persist then publish"
    // but correct for hot-path correctness.
    this.entries.set(groupId, entry);
    for (const slot of runtimeSlots) {
      this.jobToGroup.set(slot.jobId, groupId);
    }

    // The slots' BullMQ jobs are already submitted (uncancellable here)
    // and were registered with JobTracker by submitSlot using
    // `skipOrderingRegistration: true` (expecting the coordinator to
    // register the group). On putEntry failure we must register them
    // INDIVIDUALLY so their results still obey cross-message channel
    // ordering — they'd otherwise bypass the ordering buffer entirely
    // and could interleave with other channel messages. Intra-fan-out
    // slot order is lost (acceptable degradation), but cross-message
    // order is preserved.
    try {
      await this.deps.persistence.putEntry(toSnapshot(entry));
    } catch (err) {
      this.degradeToPerSlotOrdering(entry, runtimeSlots, timeoutHandle, userMessageTime, err);
      return;
    }

    // Register a SINGLE group-level entry with the ordering service — using
    // groupId as the ordering token. Individual slot jobs skip ordering
    // registration (their tracker call sets skipOrderingRegistration: true).
    this.deps.orderingService.registerJob(entry.channel.id, groupId, userMessageTime);

    logger.info(
      {
        groupId,
        slotCount: runtimeSlots.length,
        slotJobIds: runtimeSlots.map(s => s.jobId),
        sourceMessageId: input.message.id,
      },
      'Multi-tag fan-out started'
    );
  }

  /** O(1) check: is this jobId tracked by an in-flight multi-tag entry? */
  ownsJob(jobId: string): boolean {
    return this.jobToGroup.has(jobId);
  }

  /**
   * Adopt a runtime entry rebuilt by MultiTagRecovery on startup. Mirrors
   * the post-persistence branch of `startFanOut`: registers in-memory
   * ownership, hooks the group with the ordering service. If every slot
   * is already in a terminal state by the time we adopt (e.g., shutdown
   * happened mid-flush with all jobs already completed but Redis state
   * not yet deleted), flush immediately so the user finally sees the
   * delivery they were owed.
   *
   * Caller is responsible for arming the safety timer on `entry.timeoutHandle`
   * before calling this — the coordinator only clears it on flush.
   */
  async adoptRehydratedEntry(entry: RuntimeEntry): Promise<void> {
    this.entries.set(entry.groupId, entry);
    for (const slot of entry.slots) {
      this.jobToGroup.set(slot.jobId, entry.groupId);
    }
    this.deps.orderingService.registerJob(entry.channel.id, entry.groupId, entry.userMessageTime);

    const allDone = entry.slots.every(s => s.status !== 'pending');
    if (allDone) {
      // Every slot was already terminal at recovery time — flush now so
      // the user receives the delivery they were waiting on.
      await this.flushEntry(entry);
    }
  }

  /**
   * Public re-arm path for the safety timeout, intended for recovery.
   * Internal flushes drive the timeout via the timer set in `startFanOut`;
   * recovery sets up its own timer (since it didn't go through startFanOut)
   * and needs a way to invoke the same handler. Forwards to the private
   * implementation.
   */
  async handleSafetyTimeoutPublic(groupId: string): Promise<void> {
    await this.handleSafetyTimeout(groupId);
  }

  /**
   * Whether `isStale` could possibly return true given the coordinator's
   * lifetime state. Gates the Redis SISMEMBER short-circuit in
   * `MessageHandler.handleJobResult`: if no shutdown has produced stale
   * jobIds and recovery hasn't run, every non-multi-tag result would
   * otherwise pay a wasted Redis roundtrip. Becomes `true` after either
   * `beginShutdown` writes stale jobIds OR recovery calls
   * `noteRecoveryMarkedStale`.
   */
  get staleCheckNeeded(): boolean {
    return this.hasMarkedStale;
  }

  /**
   * Recovery hook: when MultiTagRecovery marks pre-restart jobIds stale on
   * startup, it must inform the coordinator so the fast-path skip flag
   * activates. Without this, recovery's stale writes would be invisible to
   * the staleCheckNeeded getter and the stale check would be skipped for
   * jobs that actually need it.
   */
  noteRecoveryMarkedStale(): void {
    this.hasMarkedStale = true;
  }

  /** Async check: was this jobId marked stale on a previous shutdown? */
  async isStale(jobId: string): Promise<boolean> {
    return this.deps.persistence.isStale(jobId);
  }

  /**
   * Remove a jobId from the stale set. Called by MessageHandler after a
   * stale result is discarded so the Redis SET doesn't grow unboundedly
   * across the lifetime of the bot.
   */
  async clearStale(jobId: string): Promise<void> {
    await this.deps.persistence.clearStale(jobId);
  }

  /**
   * Buffer a slot result. When all slots in the group reach a terminal
   * state, flush the group as an atomic burst.
   */
  async handleJobResult(jobId: string, result: LLMGenerationResult): Promise<void> {
    const groupId = this.jobToGroup.get(jobId);
    if (groupId === undefined) {
      logger.warn({ jobId }, 'handleJobResult called for unknown jobId — ignoring');
      return;
    }
    const entry = this.entries.get(groupId);
    if (entry === undefined) {
      logger.warn({ jobId, groupId }, 'handleJobResult: group entry missing — ignoring');
      return;
    }

    const slot = entry.slots.find(s => s.jobId === jobId);
    if (slot === undefined) {
      // jobId exists in jobToGroup but the in-memory entry's slot list
      // doesn't contain it — possible if updateEntry races with a delete
      // or if an in-memory/Redis state divergence happens during a crash
      // edge case. Logging this catches the case the silent skip would
      // hide.
      logger.warn({ jobId, groupId }, 'handleJobResult: slot not found in entry — ignoring');
      return;
    }
    if (slot.status !== 'pending') {
      logger.warn(
        { jobId, groupId, status: slot.status },
        'handleJobResult: slot not pending — ignoring'
      );
      return;
    }

    slot.result = result;
    slot.status = result.success === false ? 'errored' : 'completed';

    // Clear this slot's typing-indicator entry (the JobTracker context goes
    // away, but the group continues to drive typing via the remaining
    // pending slots' intervals).
    this.deps.jobTracker.completeJob(jobId);

    const allDone = entry.slots.every(s => s.status !== 'pending');
    if (allDone) {
      // Last slot — skip the intermediate snapshot write. `deliverGroup`'s
      // `deleteEntry` is about to run; one Redis roundtrip instead of two
      // (write-then-delete) for state about to disappear.
      await this.flushEntry(entry);
      return;
    }

    // Snapshot the updated state so a mid-flush crash leaves recoverable
    // progress in Redis (the next process won't re-submit completed slots).
    await this.deps.persistence.updateEntry(toSnapshot(entry));
  }

  /**
   * Begin graceful shutdown. Marks every pending slot's jobId as stale so
   * post-restart arrivals are discarded. Does NOT clear the Redis entries
   * — they self-expire via TTL today, and a future recovery path can pick
   * them up on next startup to re-submit fresh jobs.
   */
  async beginShutdown(): Promise<void> {
    this.shuttingDown = true;
    const allPendingJobIds: string[] = [];
    for (const entry of this.entries.values()) {
      for (const slot of entry.slots) {
        if (slot.status === 'pending') {
          allPendingJobIds.push(slot.jobId);
        }
      }
      clearTimeout(entry.timeoutHandle);
    }
    if (allPendingJobIds.length > 0) {
      await this.deps.persistence.markStale(...allPendingJobIds);
      this.hasMarkedStale = true;
      logger.info(
        { entryCount: this.entries.size, staleJobIdCount: allPendingJobIds.length },
        'Multi-tag coordinator shutdown — pending jobIds marked stale for recovery'
      );
    }
    this.entries.clear();
    this.jobToGroup.clear();
    this.flushingGroups.clear();
  }

  /**
   * Roll back the in-memory ownership written before the persistence
   * attempt and fall back to per-slot ordering registration. Called only
   * from `startFanOut` when `putEntry` throws — extracted to keep
   * `startFanOut` itself under the function-length cap.
   *
   * Cross-message ordering survives (each slot's jobId is registered
   * individually); intra-fan-out slot order is lost. The BullMQ jobs
   * are already submitted and can't be cancelled from here.
   *
   * **Why this doesn't touch `flushingGroups`**: `flushingGroups` is
   * only populated by `flushEntry` (the re-entry guard for the
   * deliver-burst path). `startFanOut` never adds to it, so the rollback
   * has nothing to clean up there.
   */
  private degradeToPerSlotOrdering(
    entry: RuntimeEntry,
    runtimeSlots: RuntimeSlot[],
    timeoutHandle: NodeJS.Timeout,
    userMessageTime: Date,
    err: unknown
  ): void {
    clearTimeout(timeoutHandle);
    this.entries.delete(entry.groupId);
    for (const slot of runtimeSlots) {
      this.jobToGroup.delete(slot.jobId);
    }
    logger.error(
      {
        err,
        groupId: entry.groupId,
        sourceMessageId: entry.sourceMessageId,
        slotCount: runtimeSlots.length,
      },
      'Failed to persist multi-tag entry; degrading to per-slot ordered delivery'
    );
    for (const slot of runtimeSlots) {
      this.deps.orderingService.registerJob(entry.channel.id, slot.jobId, userMessageTime);
    }
  }

  /**
   * Submit one slot's AI job through the chat manager. Returns a `SlotOutcome`
   * discriminated union: `'submitted'` with tracking details, `'denied'` on a
   * genuine refusal (denylist / NSFW / channel gate), or `'errored'` (with a
   * synthetic error result) when submission throws (transient infra failure,
   * e.g. a gateway write-timeout persisting the trigger message).
   */
  private async submitSlot(input: StartFanOutInput, resolved: ResolvedSlot): Promise<SlotOutcome> {
    try {
      const result = await this.deps.chatManager.submitChatJob({
        message: input.message,
        personality: resolved.personality,
        content: input.content,
        isAutoResponse: resolved.isAutoResponse,
      });
      if (result.kind !== 'submitted') {
        logger.debug(
          {
            reason: result.reason,
            personalityId: resolved.personality.id,
            sourceMessageId: input.message.id,
          },
          'Multi-tag slot denied — omitting from fan-out'
        );
        return { kind: 'denied', personality: resolved.personality };
      }
      // Register with JobTracker for typing-indicator refresh + context
      // storage, but skip ordering-service registration (the coordinator
      // owns the group-level entry).
      this.deps.jobTracker.trackJob(result.jobId, result.trackingContext, {
        skipOrderingRegistration: true,
      });
      return {
        kind: 'submitted',
        jobId: result.jobId,
        personality: resolved.personality,
        personaId: result.trackingContext.personaId,
        source: resolved.source,
        isAutoResponse: resolved.isAutoResponse,
      };
    } catch (err) {
      logger.error(
        { err, personalityId: resolved.personality.id, sourceMessageId: input.message.id },
        'Multi-tag slot submission threw — synthesizing as errored slot'
      );
      // Carry a synthetic result so the all-errored branch can deliver the
      // character's own error voice. The submission threw before any turn was
      // created, so this is UNKNOWN-category (not a completed job's timeout).
      // `technicalMessage` is a SAFE LITERAL — the raw `err` is logged above
      // but must never reach the user-facing (spoilered) content per
      // 00-critical's no-raw-error-leak rule.
      const spec = buildSyntheticErrorResult(resolved.personality, {
        requestId: input.message.id,
        category: ApiErrorCategory.UNKNOWN,
        type: ApiErrorType.UNKNOWN,
        technicalMessage: 'Slot submission failed',
      });
      return {
        kind: 'errored',
        personality: resolved.personality,
        isAutoResponse: resolved.isAutoResponse,
        spec,
      };
    }
  }

  /**
   * All slots reached a terminal state — deliver them as a slot-ordered
   * burst via the response-ordering service. The ordering callback hands
   * delivery back to `deliverGroup`, which sends each slot sequentially.
   */
  private async flushEntry(entry: RuntimeEntry): Promise<void> {
    // Self-protecting invariant: never run flush twice for the same group.
    // The caller-side guards (`handleJobResult` checks slot status;
    // `handleSafetyTimeout` checks remaining-pending count) are correct
    // today, but recovery paths landing in the follow-up PR will multiply
    // call-sites — make the invariant local to flushEntry itself so future
    // divergence can't cause double-delivery.
    if (this.flushingGroups.has(entry.groupId)) {
      logger.warn(
        { groupId: entry.groupId },
        'flushEntry called twice for same group — ignoring second call'
      );
      return;
    }
    this.flushingGroups.add(entry.groupId);
    try {
      logger.info(
        {
          groupId: entry.groupId,
          slotCount: entry.slots.length,
          slotStates: entry.slots.map(s => ({ id: s.personality.id, status: s.status })),
        },
        'Multi-tag flush — handing to ordering service'
      );

      // Pass a synthetic result to the ordering service; the real per-slot
      // delivery happens inside the deliverFn callback. Content uses a
      // non-XML-shaped sentinel to avoid any accidental interaction with
      // log sanitizers or XML text extractors should it ever leak.
      const syntheticResult: LLMGenerationResult = {
        requestId: entry.groupId,
        success: true,
        content: '[multi-tag-bundle]',
      };

      await this.deps.orderingService.handleResult(
        entry.channel.id,
        entry.groupId,
        syntheticResult,
        entry.userMessageTime,
        async () => deliverGroup(entry, this.deps)
      );
    } finally {
      // Unconditional in-memory teardown. Runs whether `handleResult`
      // delivered the group successfully, threw before invoking deliverFn,
      // or returned without delivering (e.g., ordering service rejected
      // the registration). Delivery-contingent cleanup (confirmDelivery,
      // DM-session write, persistence.deleteEntry) stays in `deliverGroup`
      // because those should only run when the group actually delivered.
      clearTimeout(entry.timeoutHandle);
      this.entries.delete(entry.groupId);
      for (const slot of entry.slots) {
        this.jobToGroup.delete(slot.jobId);
      }
      this.flushingGroups.delete(entry.groupId);
    }
  }

  /**
   * Safety-net timeout: a slot's result never arrived (gateway disconnect,
   * worker crash, etc). Before giving up, re-poll BullMQ once per pending
   * slot — the job may have finished with its completion event lost (the
   * listener-attach gap around a restart, or a deploy that killed the old
   * QueueEvents subscription). A real result or authoritative failure
   * delivers through the canonical handleJobResult path; only slots with
   * nothing recoverable are marked timedout and flushed synthetically.
   */
  private async handleSafetyTimeout(groupId: string): Promise<void> {
    const entry = this.entries.get(groupId);
    if (entry === undefined) {
      return; // already cleaned up
    }
    if (!entry.slots.some(s => s.status === 'pending')) {
      return; // race: flush completed while timer fired
    }

    await recoverRealResultsAtDeadline(this.deps.queue, entry, async (jobId, result) =>
      this.handleJobResult(jobId, result)
    );

    // The re-poll deliveries above may have terminal-ized every slot and
    // flushed the group (handleJobResult flushes on all-done, deleting the
    // entry). Re-read state rather than trusting the pre-poll snapshot.
    const entryAfterRepoll = this.entries.get(groupId);
    if (entryAfterRepoll === undefined) {
      return; // group fully recovered with real results — nothing to synthesize
    }
    const stillPending = entryAfterRepoll.slots.filter(s => s.status === 'pending');
    if (stillPending.length === 0) {
      return;
    }
    logger.warn(
      {
        groupId,
        pendingSlotIds: stillPending.map(s => s.personality.id),
        pendingJobIds: stillPending.map(s => s.jobId),
      },
      'Multi-tag safety timeout — flushing with synthetic timeout errors'
    );
    for (const slot of stillPending) {
      slot.status = 'timedout';
      this.deps.jobTracker.completeJob(slot.jobId);
      // Persist a late-result recovery marker BEFORE flush (deleteEntry wipes
      // the snapshot + jobId index). If the real result lands within the TTL,
      // MessageHandler delivers it as a follow-up instead of dropping it.
      // Best-effort — the helper never throws into this path. The write is not
      // awaited, so a result arriving in the sub-millisecond window before the
      // marker lands would miss recovery — identical to pre-fix drop behavior,
      // and implausible in practice (a late result is seconds-to-minutes late).
      void this.deps.persistence.markSyntheticTimeout(slot.jobId, {
        channelId: entryAfterRepoll.channel.id,
        guildId: entryAfterRepoll.guildId,
        clientId: entryAfterRepoll.clientId,
        personalitySlug: slot.personality.slug,
        recipientUserId: entryAfterRepoll.userId,
        isAutoResponse: slot.isAutoResponse,
      });
    }
    await this.flushEntry(entryAfterRepoll);
  }

  /**
   * Read the synthetic-timeout recovery context for a jobId (or null). Proxy
   * to the persistence layer so MessageHandler can check for a late-result
   * recovery without taking a direct persistence dependency — mirrors the
   * `isStale`/`clearStale` proxy pattern.
   */
  async getSyntheticTimeout(jobId: string): Promise<SyntheticTimeoutContext | null> {
    return this.deps.persistence.getSyntheticTimeout(jobId);
  }

  /** Clear a synthetic-timeout marker after a late result is handled. Proxy. */
  async clearSyntheticTimeout(jobId: string): Promise<void> {
    await this.deps.persistence.clearSyntheticTimeout(jobId);
  }
}

/**
 * The outcome of one slot submission — a discriminated union carrying the
 * personality (and, for `errored`, the classified error) so downstream
 * handling can respond per-character instead of collapsing every failure to
 * an anonymous string.
 *
 * - `'submitted'` — a live job to coordinate.
 * - `'denied'` — a genuine refusal: the character can't respond (denylisted,
 *   NSFW-gated, or restricted here). The input was understood; the character
 *   simply isn't available. Rendered as a single system notice when the whole
 *   batch is denied.
 * - `'errored'` — an infrastructure failure: the submission threw (e.g. a
 *   gateway write-timeout while persisting the trigger message). Transient.
 *   Carries a synthetic `success:false` result so the character can deliver
 *   the error IN ITS OWN VOICE (its `errorMessage`, else a canned line).
 *
 * NOTE: the `'errored'`/`'submitted'` discriminants here are DISJOINT from
 * `RuntimeSlot.status`'s `'errored'`/`'completed'` — those are post-submission
 * job-lifecycle states (a submitted slot whose result came back failed). These
 * describe whether the submission itself succeeded; they only share spelling.
 */
type SlotOutcome =
  | {
      kind: 'submitted';
      jobId: string;
      personality: LoadedPersonality;
      personaId: string;
      source: SlotSource;
      isAutoResponse: boolean;
    }
  | { kind: 'denied'; personality: LoadedPersonality }
  | {
      kind: 'errored';
      personality: LoadedPersonality;
      isAutoResponse: boolean;
      spec: LLMGenerationResult;
    };
