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
  buildReleaseCyclePlan,
  buildSubmitChatJobInput,
  clearEntryTimers,
  createCoalescingHoldEntry,
  DEFAULT_SAVE_DRAIN_TIMEOUT_MS,
  isHoldableActivationSlot,
  mergeLostPayloads,
  recordHeldTriggerInEntry,
  startBoundedPendingSaveDrain,
  type BeginSurvivorCycleOpts,
  type CoalescingHoldEntry,
  type CoalescingReleaseReason,
  type HeldTriggerContext,
  type LostSkippedPayload,
  type PendingSurvivorRelease,
} from './coalescingHoldability.js';
import type { RuntimeEntry, StartFanOutInput } from './multiTagCoordinatorHelpers.js';
import type { ResolvedSlot } from './SlotResolver.js';

const logger = createLogger('CoalescingHoldRegistry');

export type SubmitOrHoldResult = SubmitChatJobResult | { kind: 'held' };

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
  private clearEpoch = 0;

  constructor(
    private readonly chatManager: CoalescingChatManagerPort,
    private readonly onReleaseFanOut: (input: StartFanOutInput) => Promise<void>,
    private readonly holdDeadlineMs: number = COALESCING.HOLD_DEADLINE_MS,
    private readonly saveDrainTimeoutMs: number = DEFAULT_SAVE_DRAIN_TIMEOUT_MS
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
      return this.chatManager.submitChatJob(buildSubmitChatJobInput(input, resolved, nsfwGate));
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
    if (
      releaseContext?.survivorMessageId === input.message.id &&
      this.entries.get(key)?.cycleId === releaseContext.cycleId
    ) {
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
      return this.chatManager.submitChatJob(buildSubmitChatJobInput(input, resolved, nsfwGate));
    }

    // 3. Idle pair: start a new in-flight cycle and submit normally
    if (existing === undefined) {
      const entry = this.createInFlightEntry(channelId, personalityId);
      return this.submitInFlightCycle(entry.cycleId, input, resolved, nsfwGate);
    }

    // 4. Holdable plain/voice activation trigger while an entry exists:
    // register a pending-save marker synchronously BEFORE awaiting saveUserMessage
    // so a release arriving during the ~2.5s embed-processing delay waits for
    // this trigger to settle and coalesce rather than tearing down the entry.
    let finishPendingSave!: () => void;
    const saveDone = new Promise<void>(resolve => {
      finishPendingSave = resolve;
    });
    existing.pendingSaves.add(saveDone);
    const epochAtArrival = this.clearEpoch;

    try {
      const saveResult = await this.chatManager.saveUserMessage({
        message: input.message,
        personality: resolved.personality,
        content: input.content,
        nsfwGate,
      });
      if (saveResult.kind === 'denied') {
        return saveResult;
      }

      // Check clearEpoch BEFORE reading or mutating any entry: if clear() ran
      // during the await (graceful shutdown) and a new entry was later created
      // under the same key, this stale save must not mutate it or spawn a cycle.
      if (this.clearEpoch !== epochAtArrival) {
        return { kind: 'held' };
      }

      const current = this.entries.get(key);
      if (current !== undefined) {
        // Policy: any save finishing before a draining cycle finalizes joins
        // that closing cycle; any save still in flight at finalization carries
        // onto the successor cycle in beginSurvivorCycle.
        recordHeldTriggerInEntry(current, { input, resolved });

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
    } finally {
      existing.pendingSaves.delete(saveDone);
      if (this.clearEpoch === epochAtArrival) {
        this.entries.get(key)?.pendingSaves.delete(saveDone);
      }
      finishPendingSave();
    }

    // Fallback: no active entry remained after the async save (e.g. a drain
    // cutoff forced finalization to idle while this save was stalled) — submit
    // now with skipUserMessageSave: true so the trigger is never stranded.
    const freshEntry = this.createInFlightEntry(channelId, personalityId);
    return this.submitInFlightCycle(freshEntry.cycleId, input, resolved, nsfwGate, {
      skipUserMessageSave: true,
    });
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
    this.clearEpoch += 1;
    const droppedEntryCount = this.entries.size;
    for (const entry of this.entries.values()) {
      clearEntryTimers(entry);
    }
    this.entries.clear();
    this.pendingReleases.clear();
    if (droppedEntryCount > 0) {
      logger.info({ droppedEntryCount }, 'Cleared coalescing hold registry entries');
    }
  }

  private createInFlightEntry(
    channelId: string,
    personalityId: string,
    carriedPendingSaves?: ReadonlySet<Promise<void>>
  ): CoalescingHoldEntry {
    const key = this.keyFor(channelId, personalityId);
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      clearEntryTimers(existing);
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

    const entry = createCoalescingHoldEntry({
      channelId,
      personalityId,
      cycleId,
      deadlineTimer,
      carriedPendingSaves,
    });
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
      const result = await this.chatManager.submitChatJob(
        buildSubmitChatJobInput(input, resolved, nsfwGate, {
          skipUserMessageSave: releaseOpts?.skipUserMessageSave,
          skippedMessages: skippedList,
        })
      );
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
    reason: CoalescingReleaseReason,
    lost?: LostSkippedPayload
  ): Promise<void> {
    const key = this.keyFor(channelId, personalityId);
    const entry = this.entries.get(key);
    if (entry?.cycleId !== cycleId) {
      return Promise.resolve();
    }

    if (entry.drainingRelease) {
      // Preserve failure metadata if submit-denied/submit-error arrives after
      // another trigger (e.g. deadline) already started draining this cycle.
      if (lost !== undefined) {
        entry.pendingReleaseLost = mergeLostPayloads(entry.pendingReleaseLost, lost);
        entry.pendingReleaseReason = reason;
      }
      return Promise.resolve();
    }

    clearTimeout(entry.deadlineTimer);

    if (entry.pendingSaves.size > 0) {
      entry.drainingRelease = true;
      entry.pendingReleaseReason = reason;
      entry.pendingReleaseLost = mergeLostPayloads(undefined, lost);
      startBoundedPendingSaveDrain({
        entry,
        saveDrainTimeoutMs: this.saveDrainTimeoutMs,
        getCurrent: () => this.entries.get(key),
        onFinalize: current =>
          this.finalizeReleaseCycle(
            current,
            current.pendingReleaseReason ?? 'completion',
            current.pendingReleaseLost
          ),
        onError: (err, failedEntry) => {
          logger.error(
            { err, channelId: failedEntry.channelId, personalityId: failedEntry.personalityId },
            'Coalescing pending-save drain threw unexpectedly'
          );
          if (this.entries.get(key)?.cycleId === failedEntry.cycleId) {
            clearEntryTimers(failedEntry);
            this.entries.delete(key);
          }
        },
      });
      return Promise.resolve();
    }

    this.finalizeReleaseCycle(entry, reason, lost);
    return Promise.resolve();
  }

  private finalizeReleaseCycle(
    entry: CoalescingHoldEntry,
    reason: CoalescingReleaseReason,
    lost?: LostSkippedPayload
  ): void {
    const { channelId, personalityId } = entry;
    const key = this.keyFor(channelId, personalityId);
    const plan = buildReleaseCyclePlan(entry, lost);

    if (plan.kind === 'idle') {
      // No promotable context: counts-only warn (ids/content never logged) —
      // the skipped rows are lost with the cycle.
      if ((reason === 'submit-denied' || reason === 'submit-error') && plan.lostCount > 0) {
        logger.warn(
          { channelId, personalityId, skippedCount: plan.lostCount, reason },
          'Dropping skipped coalesced triggers: survivor submission did not go through'
        );
      }
      if (this.pendingReleases.get(key)?.cycleId === entry.cycleId) {
        this.pendingReleases.delete(key);
      }
      this.entries.delete(key);
      return;
    }

    if (plan.promoted) {
      logger.info(
        {
          channelId,
          personalityId,
          promotedMessageId: plan.survivor.input.message.id,
          remainingCount: plan.skipped.length,
          reason,
        },
        'Promoting newest skipped trigger after failed survivor submission'
      );
    }

    this.beginSurvivorCycle({
      channelId,
      personalityId,
      survivor: plan.survivor,
      skipped: plan.skipped,
      skippedContexts: plan.skippedContexts,
      previousJobId: plan.previousJobId,
      reason,
      holdStartedAt: entry.createdAt,
    });
  }

  /**
   * Transition into a new in-flight cycle whose survivor is `survivor`: swap
   * the entry (stamping its createdTimestamp), write the handoff, and fire the
   * detached fan-out. Shared by the release path and the failed-survivor
   * promotion path (whose remaining skipped contexts derive their wire ids).
   */
  private beginSurvivorCycle(opts: BeginSurvivorCycleOpts): void {
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
    // Transition the old entry into the new in-flight entry for the survivor,
    // carrying any saves still awaiting so the successor waits for them too.
    const nextEntry = this.createInFlightEntry(
      channelId,
      personalityId,
      this.entries.get(key)?.pendingSaves
    );
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
