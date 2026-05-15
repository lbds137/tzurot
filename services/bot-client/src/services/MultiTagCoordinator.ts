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
 * (confirmDelivery is still called so the Redis stream entry clears). The
 * user-facing experience after a restart-mid-fan-out is "no response —
 * please retry"; auto-resubmit recovery is deferred to a follow-up PR.
 */

import { randomUUID } from 'node:crypto';
import type { Message } from 'discord.js';
import {
  createLogger,
  MULTI_TAG,
  type LLMGenerationResult,
  type LoadedPersonality,
  type TypingChannel,
} from '@tzurot/common-types';
import { buildErrorContent } from '../utils/buildErrorContent.js';
import type { PersonalityChatManager } from './character/PersonalityChatManager.js';
import type { JobTracker } from './JobTracker.js';
import type { ResponseOrderingService } from './ResponseOrderingService.js';
import type { SlotDeliveryService } from './SlotDeliveryService.js';
import type { MultiTagPersistence } from './MultiTagPersistence.js';
import { pickNewDMActivePersonality, type ResolvedSlot, type SlotSource } from './SlotResolver.js';
import type { GatewayClient } from '../utils/GatewayClient.js';

const logger = createLogger('MultiTagCoordinator');

/**
 * A slot is deliverable via the success path only when its job completed,
 * the result claims success, and the content is a non-empty string. Mirrors
 * the boundary validation in `MessageHandler.handleSinglePersonalityResult`
 * so multi-tag and single-personality paths handle empty content identically.
 */
function hasUsableContent(slot: { status: string; result?: LLMGenerationResult }): boolean {
  return (
    slot.status === 'completed' &&
    slot.result !== undefined &&
    slot.result.success !== false &&
    typeof slot.result.content === 'string' &&
    slot.result.content.length > 0
  );
}

// `RuntimeSlot` and `RuntimeEntry` shapes plus the `buildSlotContext` /
// `toSnapshot` projections live in a sibling file so this orchestrator
// stays under the `max-lines` cap and the projections are unit-testable
// independently.
export type { RuntimeEntry, RuntimeSlot } from './multiTagCoordinatorHelpers.js';
import {
  buildSlotContext,
  toSnapshot,
  type RuntimeEntry,
  type RuntimeSlot,
} from './multiTagCoordinatorHelpers.js';

/** Input shape for startFanOut — what PersonalityTriggerProcessor builds. */
export interface StartFanOutInput {
  message: Message;
  channel: TypingChannel;
  /** Slots already resolved (deduped, ordered, capped) by SlotResolver. */
  slots: ResolvedSlot[];
  /** Raw effective content to pass to each slot's AI submission. */
  content: string;
}

export interface MultiTagCoordinatorDeps {
  chatManager: PersonalityChatManager;
  gatewayClient: GatewayClient;
  jobTracker: JobTracker;
  orderingService: ResponseOrderingService;
  slotDelivery: SlotDeliveryService;
  persistence: MultiTagPersistence;
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

    const runtimeSlots: RuntimeSlot[] = [];
    let nextIndex = 0;
    for (const submission of slotSubmissions) {
      if (submission === null) {
        continue; // denied slot — skip silently
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
      logger.info(
        { sourceMessageId: input.message.id },
        'All multi-tag slots denied — nothing to coordinate'
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
    };

    // Persist BEFORE registering in-memory state and the ordering-service
    // group entry. If persistence fails, we want NO partial state: no
    // entries-map, no jobToGroup, no group-level ordering registration.
    // The slots' BullMQ jobs are already submitted (uncancellable here)
    // and were registered with JobTracker by submitSlot using
    // `skipOrderingRegistration: true` (expecting the coordinator to
    // register the group). On failure we must register them INDIVIDUALLY
    // so their results still obey cross-message channel ordering — they'd
    // otherwise bypass the ordering buffer entirely and could interleave
    // with other channel messages. Intra-fan-out slot order is lost
    // (acceptable degradation), but cross-message order is preserved.
    try {
      await this.deps.persistence.putEntry(toSnapshot(entry));
    } catch (err) {
      clearTimeout(timeoutHandle);
      logger.error(
        {
          err,
          groupId,
          sourceMessageId: input.message.id,
          slotCount: runtimeSlots.length,
        },
        'Failed to persist multi-tag entry; degrading to per-slot ordered delivery'
      );
      for (const slot of runtimeSlots) {
        this.deps.orderingService.registerJob(entry.channel.id, slot.jobId, userMessageTime);
      }
      return;
    }

    this.entries.set(groupId, entry);
    for (const slot of runtimeSlots) {
      this.jobToGroup.set(slot.jobId, groupId);
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

    // Snapshot the updated state so a mid-flush crash leaves recoverable
    // progress in Redis (the next process won't re-submit completed slots).
    await this.deps.persistence.updateEntry(toSnapshot(entry));

    const allDone = entry.slots.every(s => s.status !== 'pending');
    if (allDone) {
      await this.flushEntry(entry);
    }
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
   * Submit one slot's AI job through the chat manager. Returns submission
   * details on success or null on denial (denylist / NSFW gate).
   */
  private async submitSlot(
    input: StartFanOutInput,
    resolved: ResolvedSlot
  ): Promise<SlotSubmission | null> {
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
        return null;
      }
      // Register with JobTracker for typing-indicator refresh + context
      // storage, but skip ordering-service registration (the coordinator
      // owns the group-level entry).
      this.deps.jobTracker.trackJob(result.jobId, result.trackingContext, {
        skipOrderingRegistration: true,
      });
      return {
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
      return null;
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
        async () => this.deliverGroup(entry)
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
   * Deliver a single slot's response (success or error), error-contained
   * so a failing slot can't block its siblings in the burst. Extracted from
   * `deliverGroup` to keep the loop body trivially scannable and to honor
   * the cognitive-complexity budget.
   */
  private async deliverSlot(entry: RuntimeEntry, slot: RuntimeSlot): Promise<void> {
    const slotContext = buildSlotContext(entry, slot);
    try {
      // Parity with MessageHandler.handleSinglePersonalityResult: a slot
      // marked `completed` with `success !== false` can still carry empty
      // or non-string content (rare upstream edge cases like rate-limit
      // soft-fail). Without this guard, deliverSuccess would throw, the
      // per-slot catch below would swallow it, and the user would get NO
      // response AND no error for that slot. Route through the error path
      // so the user at least sees a fallback message.
      if (hasUsableContent(slot)) {
        await this.deps.slotDelivery.deliverSuccess(
          slot.result as LLMGenerationResult & { success: true },
          slotContext
        );
        return;
      }
      if (slot.status === 'completed' && slot.result !== undefined) {
        logger.warn(
          {
            groupId: entry.groupId,
            slotIndex: slot.slotIndex,
            personalityId: slot.personality.id,
            hasContent: slot.result.content !== undefined && slot.result.content !== null,
            contentType: typeof slot.result.content,
          },
          'Slot result completed but content missing/empty — routing to error path'
        );
      }
      const synthetic: LLMGenerationResult = slot.result ?? {
        requestId: entry.groupId,
        success: false,
        error: slot.status === 'timedout' ? 'Response timed out' : 'No response received',
      };
      await this.deps.slotDelivery.deliverError(
        buildErrorContent(synthetic),
        synthetic,
        slotContext
      );
    } catch (err) {
      logger.error(
        {
          err,
          groupId: entry.groupId,
          slotIndex: slot.slotIndex,
          personalityId: slot.personality.id,
        },
        'Slot delivery threw — continuing to next slot'
      );
    }
  }

  /**
   * Sequentially send each slot's response to Discord in slot order. Called
   * by the ordering service when the group's turn arrives (i.e., no earlier
   * channel message is waiting).
   */
  private async deliverGroup(entry: RuntimeEntry): Promise<void> {
    for (const slot of entry.slots) {
      await this.deliverSlot(entry, slot);
    }

    // Best-effort delivery confirmation (clears Redis stream entries).
    await Promise.all(
      entry.slots.map(slot =>
        this.deps.gatewayClient.confirmDelivery(slot.jobId).catch(err => {
          logger.warn(
            { err, jobId: slot.jobId, groupId: entry.groupId },
            'confirmDelivery failed after multi-tag flush'
          );
        })
      )
    );

    // For DM channels, record the new active personality so the next bare
    // DM message routes to the textually-last-tagged character. Best-effort
    // — failures logged inside setDmSessionPersonality, not thrown.
    if (entry.guildId === null) {
      const newActive = pickNewDMActivePersonality(
        entry.slots.map(s => ({
          personality: s.personality,
          source: s.source,
          isAutoResponse: s.isAutoResponse,
        }))
      );
      if (newActive !== null) {
        await this.deps.gatewayClient.setDmSessionPersonality(entry.channel.id, newActive.slug);
      }
    }

    // In-memory teardown (clearTimeout, entries.delete, jobToGroup.delete,
    // flushingGroups.delete) is handled unconditionally by flushEntry's
    // finally — so a throw from orderingService.handleResult before this
    // callback runs doesn't leak entries. Only delivery-contingent cleanup
    // (Redis persistence delete) belongs here.
    //
    // Cleanup failure must not propagate up through the ordering-service
    // callback: the user-visible delivery already succeeded above, and the
    // stale Redis entry will self-clean via the 30-min TTL. A noisy log
    // here would misrepresent "delivery failed" to operators watching
    // logs; log-and-swallow is the correct posture.
    await this.deps.persistence.deleteEntry(toSnapshot(entry)).catch(err => {
      logger.warn(
        { err, groupId: entry.groupId },
        'Failed to delete coordinator entry from Redis — TTL will reclaim'
      );
    });

    logger.info(
      { groupId: entry.groupId, deliveredCount: entry.slots.length },
      'Multi-tag group delivered and cleaned up'
    );
  }

  /**
   * Safety-net timeout: a slot's result never arrived (gateway disconnect,
   * worker crash, etc). Mark remaining slots as timedout and flush.
   */
  private async handleSafetyTimeout(groupId: string): Promise<void> {
    const entry = this.entries.get(groupId);
    if (entry === undefined) {
      return; // already cleaned up
    }
    const stillPending = entry.slots.filter(s => s.status === 'pending');
    if (stillPending.length === 0) {
      return; // race: flush completed while timer fired
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
    }
    await this.flushEntry(entry);
  }
}

interface SlotSubmission {
  jobId: string;
  personality: LoadedPersonality;
  personaId: string;
  source: SlotSource;
  isAutoResponse: boolean;
}
