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
 * pending slot jobIds are added to a Redis stale set; MultiTagRecovery
 * resubmits fresh jobs on startup. Stale results that arrive post-restart
 * are dropped by the MessageHandler stale check (confirmDelivery is still
 * called so the Redis stream entry clears).
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
import type { SlotDeliveryService, SlotDeliveryContext } from './SlotDeliveryService.js';
import type { MultiTagPersistence, CoordinatorEntrySnapshot } from './MultiTagPersistence.js';
import type { ResolvedSlot, SlotSource } from './SlotResolver.js';
import type { GatewayClient } from '../utils/GatewayClient.js';

const logger = createLogger('MultiTagCoordinator');

/** Per-slot runtime state. `personality` is the live LoadedPersonality (not persisted). */
interface RuntimeSlot {
  slotIndex: number;
  personality: LoadedPersonality;
  personaId: string;
  source: SlotSource;
  isAutoResponse: boolean;
  jobId: string;
  status: 'pending' | 'completed' | 'errored' | 'timedout';
  result?: LLMGenerationResult;
}

/**
 * Per-fan-out runtime state. `message` and `channel` are live Discord objects
 * — re-fetched during recovery via Discord API.
 */
export interface RuntimeEntry {
  groupId: string;
  sourceMessageId: string;
  message: Message;
  channel: TypingChannel;
  guildId: string | null;
  clientId: string | undefined;
  userId: string;
  userMessageTime: Date;
  userMessageContent: string;
  slots: RuntimeSlot[];
  createdAt: number;
  /** Safety-net timeout handle — fires forceFlush if pending too long. */
  timeoutHandle: NodeJS.Timeout;
}

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
      void this.handleSafetyTimeout(groupId);
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

    this.entries.set(groupId, entry);
    for (const slot of runtimeSlots) {
      this.jobToGroup.set(slot.jobId, groupId);
    }

    // Persist BEFORE registering with ordering service so a crash between
    // ordering-registration and result delivery still has recoverable state.
    await this.deps.persistence.putEntry(toSnapshot(entry));

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
    if (slot?.status !== 'pending') {
      logger.warn({ jobId, groupId }, 'handleJobResult: slot not pending — ignoring');
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
   * — recovery picks them up on next startup and re-submits fresh jobs.
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
    logger.info(
      {
        groupId: entry.groupId,
        slotCount: entry.slots.length,
        slotStates: entry.slots.map(s => ({ id: s.personality.id, status: s.status })),
      },
      'Multi-tag flush — handing to ordering service'
    );

    // Pass a synthetic result to the ordering service; the real per-slot
    // delivery happens inside the deliverFn callback.
    const syntheticResult: LLMGenerationResult = {
      requestId: entry.groupId,
      success: true,
      content: '<multi-tag-bundle>',
    };

    await this.deps.orderingService.handleResult(
      entry.channel.id,
      entry.groupId,
      syntheticResult,
      entry.userMessageTime,
      async () => this.deliverGroup(entry)
    );
  }

  /**
   * Sequentially send each slot's response to Discord in slot order. Called
   * by the ordering service when the group's turn arrives (i.e., no earlier
   * channel message is waiting).
   */
  private async deliverGroup(entry: RuntimeEntry): Promise<void> {
    for (const slot of entry.slots) {
      const slotContext = buildSlotContext(entry, slot);
      try {
        if (slot.status === 'completed' && slot.result && slot.result.success !== false) {
          await this.deps.slotDelivery.deliverSuccess(
            slot.result as LLMGenerationResult & { success: true },
            slotContext
          );
        } else {
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
        }
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

    // Tear down: clear timeout, in-memory state, Redis entry.
    clearTimeout(entry.timeoutHandle);
    this.entries.delete(entry.groupId);
    for (const slot of entry.slots) {
      this.jobToGroup.delete(slot.jobId);
    }
    await this.deps.persistence.deleteEntry(toSnapshot(entry));

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

/**
 * Build the SlotDeliveryContext for one slot. Pure projection — every field
 * is either constant across the group (channel/guild/clientId/message) or
 * slot-specific (personality/persona/isAutoResponse).
 */
function buildSlotContext(entry: RuntimeEntry, slot: RuntimeSlot): SlotDeliveryContext {
  return {
    message: entry.message,
    channel: entry.channel,
    guildId: entry.guildId,
    clientId: entry.clientId,
    personality: slot.personality,
    personaId: slot.personaId,
    userMessageContent: entry.userMessageContent,
    userMessageTime: entry.userMessageTime,
    isAutoResponse: slot.isAutoResponse,
    recipientUserId: entry.userId,
  };
}

/** Project the runtime entry into the Redis-storable snapshot. */
function toSnapshot(entry: RuntimeEntry): CoordinatorEntrySnapshot {
  return {
    groupId: entry.groupId,
    sourceMessageId: entry.sourceMessageId,
    channelId: entry.channel.id,
    guildId: entry.guildId,
    userId: entry.userId,
    userMessageTime: entry.userMessageTime.toISOString(),
    userMessageContent: entry.userMessageContent,
    slots: entry.slots.map(s => ({
      slotIndex: s.slotIndex,
      personalityId: s.personality.id,
      personalitySlug: s.personality.slug,
      source: s.source,
      isAutoResponse: s.isAutoResponse,
      jobId: s.jobId,
      status: s.status,
    })),
    createdAt: entry.createdAt,
  };
}
