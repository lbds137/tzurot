/**
 * CoalescingHoldRegistry — latest-wins pre-enqueue hold for activated-channel chatter.
 *
 * Invariants:
 * - Latest wins: while a generation for a (channelId, personalityId) pair is in flight,
 *   arriving activation-sourced plain-text and voice triggers are held in memory; only
 *   the newest held trigger is submitted when the in-flight generation releases, while
 *   older held triggers become the survivor payload's skippedMessages list.
 * - Release after delivery: the coordinator releases a pair's hold only after the
 *   awaited job's response (or terminal error/timeout) has been delivered and its
 *   assistant history row persisted, or when the entry's own short hold deadline fires.
 *   Documented exception: the degraded per-slot-ordering path (entry persistence
 *   failure) releases its slots immediately without the delivery funnel —
 *   cross-message ordering still holds via the ordering service's registerJob,
 *   and that immediate release can dispatch a held survivor while the first job
 *   is still in flight, so two generations for the same (channelId, personalityId)
 *   pair can overlap for that cycle.
 * - Per-message history and memory: each held trigger persists its user history row
 *   immediately at hold time, and the released survivor skips re-saving its user row
 *   while carrying the capped skippedMessages list for per-author deferred memory.
 * - Attachment-bearing triggers (image or file/document) never coalesce; they submit
 *   immediately and leave any existing hold entry untouched.
 */

import { COALESCING } from '@tzurot/common-types/constants/message';
import { type SkippedMessage } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type {
  PersonalityChatManager,
  SubmitChatJobResult,
} from './character/PersonalityChatManager.js';
import type { NsfwGate } from './character/sharedNsfwGate.js';
import {
  isHoldableActivationSlot,
  mergeSkippedForSurvivor,
  pushToSkippedLists,
  type HeldTriggerContext,
} from './coalescingHoldability.js';
import type { RuntimeEntry, StartFanOutInput } from './multiTagCoordinatorHelpers.js';
import type { ResolvedSlot } from './SlotResolver.js';

const logger = createLogger('CoalescingHoldRegistry');

/** In-memory coalescing hold state for one (channelId, personalityId) pair. */
export interface CoalescingHoldEntry {
  channelId: string;
  personalityId: string;
  awaitedJobId: string | null;
  newest: HeldTriggerContext | null;
  skipped: SkippedMessage[];
  /**
   * Full in-memory context ({input, resolved}) per skipped trigger, aligned
   * with `skipped` and capped identically. Never serialized to the wire (the
   * wire payload stays id-only `skipped`): it lets a failed survivor
   * submission promote the newest skipped trigger instead of dropping the
   * held rows.
   */
  skippedContexts: HeldTriggerContext[];
  createdAt: number;
  deadlineTimer: NodeJS.Timeout;
  cycleId: number;
  /**
   * Discord createdTimestamp of the released survivor this in-flight cycle was
   * created for, stamped at release so a trigger whose save resolves after the
   * release can be recognized as older than the answer already owed: one
   * strictly older goes straight to skipped instead of becoming this cycle's
   * newest and answering before the survivor. Undefined on a cycle started
   * from an idle pair (no survivor yet).
   */
  survivorCreatedTimestamp?: number;
}

export type SubmitOrHoldResult = SubmitChatJobResult | { kind: 'held' };

interface PendingSurvivorRelease {
  cycleId: number;
  /** The survivor this handoff belongs to — step 1 consumes only for it. */
  survivorMessageId: string;
  skippedMessages: SkippedMessage[];
  /** Full in-memory contexts backing `skippedMessages`, for survivor promotion. */
  skippedContexts: HeldTriggerContext[];
}

export type CoalescingChatManagerPort = Pick<
  PersonalityChatManager,
  'submitChatJob' | 'saveUserMessage'
>;

export class CoalescingHoldRegistry {
  private readonly entries = new Map<string, CoalescingHoldEntry>();
  /**
   * Handoff for a released survivor, written before `onReleaseFanOut` and
   * consumed (and deleted) by the survivor's own `submitOrHoldSlot` step 1.
   * Race-free only while the coordinator's `startFanOut` reaches
   * `submitOrHoldSlot` without inserting an extra await of its own first: an
   * unrelated trigger for the same pair arriving in that window would consume
   * the handoff instead, and the survivor would lose its skippedMessages row.
   * If the fan-out is refused outright (e.g. `shuttingDown`) the handoff is
   * left unconsumed, so `releaseCycle` clears it after the call returns
   * (identity check below) rather than letting it leak onto a later,
   * unrelated trigger.
   */
  private readonly pendingReleases = new Map<string, PendingSurvivorRelease>();
  private nextCycleId = 0;

  constructor(
    private readonly chatManager: CoalescingChatManagerPort,
    private readonly onReleaseFanOut: (input: StartFanOutInput) => Promise<void>,
    private readonly holdDeadlineMs: number = COALESCING.HOLD_DEADLINE_MS
  ) {}

  private keyFor(channelId: string, personalityId: string): string {
    return `${channelId}:${personalityId}`;
  }

  /** @internal Inspect current entry for tests/diagnostics (not public API). */
  getEntry(channelId: string, personalityId: string): CoalescingHoldEntry | undefined {
    return this.entries.get(this.keyFor(channelId, personalityId));
  }

  /**
   * Decide whether to submit a slot immediately or hold it behind an in-flight
   * generation for the same (channelId, personalityId) pair.
   */
  async submitOrHoldSlot(
    input: StartFanOutInput,
    resolved: ResolvedSlot,
    nsfwGate: NsfwGate
  ): Promise<SubmitOrHoldResult> {
    if (resolved.source !== 'activation') {
      return this.chatManager.submitChatJob({
        message: input.message,
        personality: resolved.personality,
        content: input.content,
        isAutoResponse: resolved.isAutoResponse,
        nsfwGate,
      });
    }

    const channelId = input.channel.id;
    const personalityId = resolved.personality.id;
    const key = this.keyFor(channelId, personalityId);

    // 1. Releasing survivor path: submit with skipUserMessageSave + skippedMessages.
    // Consumed only by the handoff's own survivor — an unrelated trigger for
    // the same pair arriving in the window must not steal the handoff (it
    // would lose the skippedMessages row AND submit with skipUserMessageSave,
    // so its own row would never persist). It falls through to the normal
    // hold path; the real survivor still finds its handoff here.
    const releaseContext = this.pendingReleases.get(key);
    if (releaseContext?.survivorMessageId === input.message.id) {
      this.pendingReleases.delete(key);
      return this.submitInFlightCycle(releaseContext.cycleId, input, resolved, nsfwGate, {
        skipUserMessageSave: true,
        skippedMessages: releaseContext.skippedMessages,
        skippedContexts: releaseContext.skippedContexts,
      });
    }

    const holdable = isHoldableActivationSlot(input.message, resolved);
    const existing = this.entries.get(key);

    // 2. Attachment-bearing trigger while an entry exists: normal immediate submit, hold untouched
    if (!holdable && existing !== undefined) {
      return this.chatManager.submitChatJob({
        message: input.message,
        personality: resolved.personality,
        content: input.content,
        isAutoResponse: resolved.isAutoResponse,
        nsfwGate,
      });
    }

    // 3. Idle pair: start a new in-flight cycle and submit normally
    if (existing === undefined) {
      const entry = this.createInFlightEntry(channelId, personalityId);
      return this.submitInFlightCycle(entry.cycleId, input, resolved, nsfwGate);
    }

    // 4. Holdable plain/voice activation trigger while an entry exists:
    // run gates + save user row immediately, then update newest / skipped
    const saveResult = await this.chatManager.saveUserMessage({
      message: input.message,
      personality: resolved.personality,
      content: input.content,
      nsfwGate,
    });
    if (saveResult.kind === 'denied') {
      return saveResult;
    }

    // Re-read entry after the async save: if the in-flight job released while
    // saveUserMessage was awaiting, and no new entry took its place, submit now
    // with skipUserMessageSave: true so the trigger is never stranded.
    const current = this.entries.get(key);
    if (current === undefined) {
      const freshEntry = this.createInFlightEntry(channelId, personalityId);
      return this.submitInFlightCycle(freshEntry.cycleId, input, resolved, nsfwGate, {
        skipUserMessageSave: true,
      });
    }

    if (current.newest !== null) {
      // Latest-wins by Discord timestamps, not by resolve order: whoever's
      // saveUserMessage resolves last is not necessarily the newest message.
      // On an exact tie the incumbent stays newest; an arriving older message
      // takes the incumbent's place on the skipped list instead.
      const arrivingNewer =
        input.message.createdTimestamp > current.newest.input.message.createdTimestamp;
      const displaced = arrivingNewer ? current.newest : { input, resolved };
      pushToSkippedLists(current, displaced);
      if (arrivingNewer) {
        current.newest = { input, resolved };
      }
    } else if (
      current.survivorCreatedTimestamp !== undefined &&
      input.message.createdTimestamp < current.survivorCreatedTimestamp
    ) {
      // Strictly older than the survivor whose release created this cycle:
      // it would answer BEFORE the survivor if it became this cycle's newest,
      // so straight to skipped. Exact ties become newest — save-resolution
      // order already orders them.
      pushToSkippedLists(current, { input, resolved });
    } else {
      current.newest = { input, resolved };
    }

    logger.info(
      {
        channelId,
        personalityId,
        awaitedJobId: current.awaitedJobId,
        newestMessageId: input.message.id,
        skippedCount: current.skipped.length,
      },
      'Held activation trigger behind in-flight generation'
    );

    return { kind: 'held' };
  }

  /**
   * Run a group delivery callback and release holds for every slot afterward.
   */
  async deliverAndRelease(
    entry: Pick<RuntimeEntry, 'channel' | 'slots'>,
    deliver: () => Promise<void>
  ): Promise<void> {
    try {
      await deliver();
    } finally {
      await this.releaseEntrySlots(entry);
    }
  }

  /**
   * Release holds for every slot in a completed/failed/timed-out coordinator entry.
   */
  async releaseEntrySlots(entry: Pick<RuntimeEntry, 'channel' | 'slots'>): Promise<void> {
    for (const slot of entry.slots) {
      await this.release(entry.channel.id, slot.personality.id, slot.jobId);
    }
  }

  /**
   * Release the hold for (channelId, personalityId) when its awaited job finishes
   * (delivery or terminal failure) or when invoked without a jobId filter.
   * With a jobId filter, the hold releases only when the entry's awaitedJobId
   * already names that job — while awaitedJobId is still null (the in-flight
   * job has not been recorded yet) a filtered release is ignored.
   */
  async release(channelId: string, personalityId: string, completedJobId?: string): Promise<void> {
    const key = this.keyFor(channelId, personalityId);
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return;
    }
    if (completedJobId !== undefined && entry.awaitedJobId !== completedJobId) {
      return;
    }
    await this.releaseCycle(channelId, personalityId, entry.cycleId, 'completion');
  }

  /**
   * Clear all hold timers and drop all in-memory entries (used on shutdown).
   */
  clear(): void {
    const droppedEntryCount = this.entries.size;
    for (const entry of this.entries.values()) {
      clearTimeout(entry.deadlineTimer);
    }
    this.entries.clear();
    this.pendingReleases.clear();
    if (droppedEntryCount > 0) {
      logger.info({ droppedEntryCount }, 'Cleared coalescing hold registry entries');
    }
  }

  private createInFlightEntry(channelId: string, personalityId: string): CoalescingHoldEntry {
    const key = this.keyFor(channelId, personalityId);
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      clearTimeout(existing.deadlineTimer);
    }
    const cycleId = ++this.nextCycleId;
    const deadlineTimer = setTimeout(() => {
      void this.releaseCycle(channelId, personalityId, cycleId, 'deadline').catch(err => {
        logger.error(
          { err, channelId, personalityId },
          'Coalescing hold deadline release threw unexpectedly'
        );
      });
    }, this.holdDeadlineMs);

    const entry: CoalescingHoldEntry = {
      channelId,
      personalityId,
      awaitedJobId: null,
      newest: null,
      skipped: [],
      skippedContexts: [],
      createdAt: Date.now(),
      deadlineTimer,
      cycleId,
    };
    this.entries.set(key, entry);
    return entry;
  }

  private async submitInFlightCycle(
    cycleId: number,
    input: StartFanOutInput,
    resolved: ResolvedSlot,
    nsfwGate: NsfwGate,
    releaseOpts?: {
      skipUserMessageSave?: boolean;
      skippedMessages?: SkippedMessage[];
      skippedContexts?: HeldTriggerContext[];
    }
  ): Promise<SubmitChatJobResult> {
    const channelId = input.channel.id;
    const personalityId = resolved.personality.id;
    const key = this.keyFor(channelId, personalityId);
    const skippedList = releaseOpts?.skippedMessages;
    const skippedContexts = releaseOpts?.skippedContexts;
    // Shared failure arm: a denied or thrown submission releases THIS cycle,
    // promoting the newest skipped context when one rode along.
    const failCurrentCycle = async (reason: 'submit-denied' | 'submit-error'): Promise<void> => {
      const current = this.entries.get(key);
      if (current?.cycleId === cycleId) {
        await this.releaseCycle(channelId, personalityId, cycleId, reason, {
          skippedCount: skippedList?.length ?? 0,
          skippedContexts: skippedContexts ?? [],
        });
      }
    };
    try {
      const nonEmptySkipped =
        skippedList !== undefined && skippedList.length > 0 ? skippedList : undefined;
      const result = await this.chatManager.submitChatJob({
        message: input.message,
        personality: resolved.personality,
        content: input.content,
        isAutoResponse: resolved.isAutoResponse,
        nsfwGate,
        ...(releaseOpts?.skipUserMessageSave === true ? { skipUserMessageSave: true } : {}),
        ...(nonEmptySkipped !== undefined ? { skippedMessages: nonEmptySkipped } : {}),
      });
      if (result.kind === 'submitted') {
        const current = this.entries.get(key);
        if (current?.cycleId === cycleId) {
          current.awaitedJobId = result.jobId;
        }
        return result;
      }
      await failCurrentCycle('submit-denied');
      return result;
    } catch (err) {
      await failCurrentCycle('submit-error');
      throw err;
    }
  }

  /**
   * Synchronous state transition (entry swap + handoff write), returning a
   * resolved promise: the survivor fan-out is detached, so awaiting this only
   * yields once the state is durable — never for the submission itself.
   * `lost` carries the failed survivor's skipped payload (counts for the warn,
   * full contexts for promotion); absent on completion/deadline paths.
   */
  private releaseCycle(
    channelId: string,
    personalityId: string,
    cycleId: number,
    reason: 'completion' | 'deadline' | 'submit-denied' | 'submit-error',
    lost?: { skippedCount: number; skippedContexts: HeldTriggerContext[] }
  ): Promise<void> {
    const key = this.keyFor(channelId, personalityId);
    const entry = this.entries.get(key);
    if (entry?.cycleId !== cycleId) {
      return Promise.resolve();
    }

    clearTimeout(entry.deadlineTimer);

    if (entry.newest === null) {
      const lostContexts = lost?.skippedContexts ?? [];
      // Survivor-submission failure (submit-denied/submit-error): promote the
      // newest skipped trigger (highest createdTimestamp) to survivor — its
      // full context resubmits through a fresh cycle carrying the remaining
      // skipped — instead of dropping the held rows. The contexts are
      // in-memory only; the resubmitted wire payload stays id-only.
      if (lostContexts.length > 0) {
        const sorted = [...lostContexts].sort(
          (a, b) => b.input.message.createdTimestamp - a.input.message.createdTimestamp
        );
        const promoted = sorted[0];
        const remaining = sorted.slice(1);
        logger.info(
          {
            channelId,
            personalityId,
            promotedMessageId: promoted.input.message.id,
            remainingCount: remaining.length,
            reason,
          },
          'Promoting newest skipped trigger after failed survivor submission'
        );
        this.beginSurvivorCycle({
          channelId,
          personalityId,
          survivor: promoted,
          skipped: remaining.map(c => ({
            messageId: c.input.message.id,
            authorId: c.input.message.author.id,
          })),
          skippedContexts: remaining,
          previousJobId: null,
          reason,
          holdStartedAt: entry.createdAt,
        });
        return Promise.resolve();
      }
      // No promotable context: counts-only warn (ids/content never logged) —
      // the skipped rows are lost with the cycle.
      const lostCount = lost?.skippedCount ?? 0;
      if ((reason === 'submit-denied' || reason === 'submit-error') && lostCount > 0) {
        logger.warn(
          { channelId, personalityId, skippedCount: lostCount, reason },
          'Dropping skipped coalesced triggers: survivor submission did not go through'
        );
      }
      this.entries.delete(key);
      return Promise.resolve();
    }

    const { skipped, skippedContexts } = mergeSkippedForSurvivor(
      entry,
      lost?.skippedContexts ?? []
    );
    this.beginSurvivorCycle({
      channelId,
      personalityId,
      survivor: entry.newest,
      skipped,
      skippedContexts,
      previousJobId: entry.awaitedJobId,
      reason,
      holdStartedAt: entry.createdAt,
    });
    return Promise.resolve();
  }

  /**
   * Transition into a new in-flight cycle whose survivor is `survivor`: swap
   * the entry (stamping its createdTimestamp), write the handoff, and fire the
   * detached fan-out. Shared by the release path and the failed-survivor
   * promotion path (whose remaining skipped contexts derive their wire ids).
   */
  private beginSurvivorCycle(opts: {
    channelId: string;
    personalityId: string;
    survivor: HeldTriggerContext;
    skipped: SkippedMessage[];
    skippedContexts: HeldTriggerContext[];
    previousJobId: string | null;
    reason: 'completion' | 'deadline' | 'submit-denied' | 'submit-error';
    holdStartedAt: number;
  }): void {
    const {
      channelId,
      personalityId,
      survivor,
      skipped,
      skippedContexts,
      previousJobId,
      reason,
      holdStartedAt,
    } = opts;
    const key = this.keyFor(channelId, personalityId);
    // Transition the old entry into the new in-flight entry for the survivor
    const nextEntry = this.createInFlightEntry(channelId, personalityId);
    nextEntry.survivorCreatedTimestamp = survivor.input.message.createdTimestamp;
    const handoff: PendingSurvivorRelease = {
      cycleId: nextEntry.cycleId,
      survivorMessageId: survivor.input.message.id,
      skippedMessages: skipped,
      skippedContexts,
    };
    this.pendingReleases.set(key, handoff);

    logger.info(
      {
        channelId,
        personalityId,
        previousJobId,
        survivorMessageId: survivor.input.message.id,
        skippedCount: skipped.length,
        skippedMessageIds: skipped.map(s => s.messageId),
        reason,
        holdDurationMs: Date.now() - holdStartedAt,
      },
      'Releasing coalesced survivor trigger'
    );

    // Detached on purpose: the survivor's full submission (gates, config
    // resolve, context build, gateway POST, putEntry) must not hold the
    // channel's ordering loop while it runs. The state transition above is
    // complete before this call, so the release still happens strictly after
    // delivery — only the survivor's submission is asynchronous now.
    void this.onReleaseFanOut({
      ...survivor.input,
      slots: [survivor.resolved],
      truncated: false,
    })
      .catch((err: unknown) => {
        logger.error(
          { err, channelId, personalityId },
          'Detached survivor fan-out threw unexpectedly'
        );
      })
      .finally(() => {
        // If the survivor never consumed the handoff (a refused fan-out, e.g.
        // shuttingDown, or the release call throwing), clear it — a stale
        // handoff must not leak onto a later, unrelated trigger for this pair.
        if (this.pendingReleases.get(key) === handoff) {
          this.pendingReleases.delete(key);
        }
      });
  }
}
