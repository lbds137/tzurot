/**
 * MultiTagRecovery — startup hook that rehydrates in-flight multi-tag
 * fan-outs after a bot restart.
 *
 * **Why this exists**: when the bot shuts down (graceful or crash), pending
 * multi-tag fan-outs leave Redis entries behind. Without recovery, those
 * entries would never produce user-visible responses, and any results the
 * old ai-worker finished publishing AFTER the old bot-client died would be
 * silently lost — the new bot-client's fresh `QueueEvents` / Redis-Stream
 * subscriptions don't replay events emitted before they attached, even
 * though the BullMQ job state itself still holds the result.
 *
 * **Algorithm** (run BEFORE ResultsListener starts):
 *   1. Scan `multitag:entry:*` Redis keys via `MultiTagPersistence.scanAllEntries`.
 *   2. For each snapshot:
 *      - For each pending slot: poll BullMQ for the OLD job's authoritative
 *        state via `queue.getJob().getState()` (cheap local Redis reads —
 *        deliberately BEFORE the rate-limited Discord fetches below). Routes:
 *          • `'completed'` → consume `job.returnvalue` and feed it through
 *            `coordinator.handleJobResult` after adoption (deferred delivery).
 *          • `'failed'` → synthesize an error `LLMGenerationResult` from
 *            `job.failedReason` and route through the same entrypoint.
 *          • `'active' | 'waiting' | 'delayed' | 'prioritized' | 'waiting-children'` →
 *            adopt the slot as still-pending with the old jobId; the live
 *            stream + QueueEvents subscriptions will deliver the result
 *            when the ai-worker finishes.
 *          • Job evicted from Redis (`getJob` returns null) → synthesize
 *            an "unavailable after restart" failure result.
 *          • `getJob` / `getState` throws → fall back to adopting as
 *            still-pending; don't fail recovery for a transient Redis blip.
 *            This outcome is NOT evidence the job is live — the marker pass
 *            below is what separates a genuinely-running job from one whose
 *            reply the prior run already sent.
 *      - For each terminal slot in the snapshot: preserve as-is (the result
 *        was never persisted in the snapshot, so the slot will flush as an
 *        error via the existing `deliverError` path — same as before).
 *      - **Already-delivered pass**: reconcile EVERY slot — in-flight ones
 *        included, since a failed state poll is indistinguishable from a live
 *        job at this layer — against the `slot-delivered:{jobId}` marker the
 *        prior process wrote after each successful Discord send. A delivered slot enters the
 *        rehydrated entry TERMINAL (never pending) and carries
 *        `alreadyDelivered`, so the re-armed safety timer covers only slots
 *        that can still produce output and the eventual flush skips re-sending
 *        it. When EVERY slot is already delivered the entry is cleaned up
 *        instead of rehydrated — before the Discord fetches below. Every
 *        discard path confirms delivery for the slots the prior run sent,
 *        since none of them reaches `deliverGroup`'s own confirm fan-out.
 *      - **Age gate**: an entry older than `MULTI_TAG.COORDINATOR_TIMEOUT_MS`
 *        is adopted only if a slot recovered a real completed result. The
 *        old instance would already have safety-flushed such a group, so a
 *        still-pending slot is wedged (e.g. a `waiting-children` parent
 *        whose children died with an earlier worker) — adopting it only
 *        schedules a late synthetic error while blocking the channel's
 *        ordering. No result → discard silently, BEFORE the Discord fetches
 *        (a boot recovering several zombies must not spend two API calls
 *        per entry it's about to throw away).
 *      - Fetch Discord channel + source message. If either fails (channel
 *        deleted, message deleted), discard the entry — the user can't be
 *        delivered to anyway.
 *      - Adopt the rehydrated runtime entry into the coordinator's
 *        in-memory maps + register with orderingService.
 *      - After adoption, dispatch the collected deferred deliveries via
 *        `coordinator.handleJobResult(jobId, syntheticResult)`. This routes
 *        through the same flush path live results travel.
 *   3. Notify coordinator that stale jobIds exist (flips the
 *      `staleCheckNeeded` fast-path flag) so MessageHandler runs the
 *      isStale check post-recovery for any entries that were discarded.
 *
 * **No resubmission**: prior versions of this service resubmitted a fresh
 * AI job for every still-pending slot at recovery time. That wasted API
 * tokens and produced different content than what the user would have
 * received absent the restart — and crucially, results the prior process
 * had already produced were thrown away in favour of duplicate work. The
 * BullMQ-state poll above replaces resubmission entirely.
 *
 * **Critical ordering**: `run()` MUST complete before `ResultsListener.start()`.
 * The stale-set filter (populated during discard) is what makes results
 * for discarded entries safe to drop; without it, a delayed delivery could
 * arrive during recovery and race the discard logic. For the in-flight
 * branch, the slot retains its original jobId, so the stream/event
 * subscriptions deliver normally once they attach.
 *
 * **Discord readiness**: callers must invoke `run()` AFTER `client.login()`
 * completes — channel/message fetches require an authenticated client.
 */

import type { Client, Message } from 'discord.js';
import type { Queue } from 'bullmq';
import { MULTI_TAG } from '@tzurot/common-types/constants/message';
import { type TypingChannel } from '@tzurot/common-types/types/discord-types';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { fetchTypingChannel } from '../utils/fetchTypingChannel.js';
import type { MultiTagCoordinator } from './MultiTagCoordinator.js';
import type {
  MultiTagPersistence,
  CoordinatorEntrySnapshot,
  SlotSnapshot,
} from './MultiTagPersistence.js';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import type { RuntimeEntry, RuntimeSlot } from './multiTagCoordinatorHelpers.js';
import {
  applyAlreadyDeliveredMarkers,
  buildRuntimeSlots,
  buildSentinelPersonality,
  discardRecoveredEntry,
  dispatchDeferredDeliveries,
  pollPriorJobState,
  synthesizeFailureResult,
  tallyEntrySlots,
  type DeferredDelivery,
  type RecoveryStats,
} from './multiTagRecoveryHelpers.js';

const logger = createLogger('MultiTagRecovery');

/**
 * Floor for the re-armed safety timer of a rehydrated entry. The timer
 * preserves the group's ORIGINAL deadline (createdAt + coordinator budget),
 * so an entry adopted near — or, via the completed-result exception in the
 * age gate, past — its deadline could otherwise get a zero/negative delay.
 * The floor leaves room for adoption + deferred-delivery dispatch to finish
 * before the flush fires.
 */
export const RECOVERY_TIMER_FLOOR_MS = 60 * 1000;

export interface MultiTagRecoveryDeps {
  persistence: MultiTagPersistence;
  coordinator: MultiTagCoordinator;
  personalityService: IPersonalityLoader;
  discordClient: Client;
  /**
   * BullMQ queue handle for the AI-requests queue. Used to poll the
   * authoritative state (`completed | failed | active | ...`) of jobs that
   * were in flight when the bot last shut down. Constructed in
   * `index.ts`'s composition root and closed in the shutdown sequence.
   */
  queue: Queue;
}

export class MultiTagRecovery {
  constructor(private readonly deps: MultiTagRecoveryDeps) {}

  async run(): Promise<RecoveryStats> {
    const stats: RecoveryStats = {
      entriesScanned: 0,
      entriesResumed: 0,
      entriesDiscarded: 0,
      entriesExpiredSilent: 0,
      slotsRecoveredCompleted: 0,
      slotsRecoveredFailed: 0,
      slotsTrustedToStream: 0,
      slotsUnrecoverable: 0,
      slotsAccessRevoked: 0,
      staleJobIdsMarked: 0,
      slotsAlreadyDelivered: 0,
    };

    let snapshots: CoordinatorEntrySnapshot[];
    try {
      snapshots = await this.deps.persistence.scanAllEntries();
    } catch (err) {
      logger.error({ err }, 'Recovery scan failed — skipping multi-tag recovery this startup');
      return stats;
    }

    stats.entriesScanned = snapshots.length;
    if (snapshots.length === 0) {
      logger.info('No multi-tag entries to recover');
      return stats;
    }

    // Sequential (not Promise.allSettled) is intentional. Each entry
    // makes 2 Discord API calls (channels.fetch + messages.fetch) plus
    // one BullMQ state-poll per pending slot. Parallelizing across N
    // entries on a fresh bot startup would risk Discord rate limits
    // (especially after a heavy-traffic shutdown that left many in-flight
    // fan-outs). Recovery is rare and runs once per process; the extra
    // wall time is acceptable.
    for (const snapshot of snapshots) {
      await this.recoverOne(snapshot, stats);
    }

    // Notify coordinator so its `staleCheckNeeded` fast-path skip-flag
    // becomes active for the rest of the process lifetime. Without this,
    // MessageHandler would skip the isStale check and could deliver
    // pre-restart results to entries that were discarded here.
    //
    // Defensive `entriesDiscarded` clause: discardEntry only counts
    // staleJobIdsMarked for the PENDING slots it marks stale. An entry
    // discarded with only terminal slots (channel deleted, all jobs
    // already done) leaves staleJobIdsMarked at 0 even though we
    // recovered SOMETHING from Redis. In practice, terminal jobIds
    // shouldn't produce more results — but if a delayed delivery did
    // arrive, the conservative flag-flip lets MessageHandler check the
    // stale set rather than fall through silently.
    if (stats.staleJobIdsMarked > 0 || stats.entriesDiscarded > 0) {
      this.deps.coordinator.noteRecoveryMarkedStale();
    }

    logger.info({ ...stats }, 'Multi-tag recovery complete');
    return stats;
  }

  /**
   * Recover one entry. Internal helper; mutates `stats` to record outcomes.
   * Catches per-entry errors so one bad entry doesn't poison the rest.
   */
  private async recoverOne(
    snapshot: CoordinatorEntrySnapshot,
    stats: RecoveryStats
  ): Promise<void> {
    try {
      // Build runtime slots: poll BullMQ state for pending slots, preserve
      // terminal ones. Slots whose personality became inaccessible are
      // kept as errored sentinel slots (not dropped) so the group still
      // flushes a fallback error message for each position.
      const {
        runtimeSlots,
        deferredDeliveries,
        trustedToStreamCount: entryTrustedToStreamCount,
      } = await buildRuntimeSlots(snapshot.slots, slotSnap =>
        this.rebuildSlot(slotSnap, snapshot, stats)
      );

      if (runtimeSlots.length === 0) {
        // Defense-in-depth: `parseSnapshotOrLog` validates `slots.length > 0`
        // at parse time, so this branch should be unreachable. Kept as a
        // floor against future schema/validation drift — a malformed
        // snapshot with zero slots shouldn't crash recovery.
        // No slots means no marker pass has run and nothing can have been
        // delivered, so there is no jobId to confirm.
        await this.discardEntry(snapshot, 'snapshot has zero slots', stats, []);
        return;
      }

      // Reconcile against the prior run's slot-delivered markers BEFORE the
      // entry is built. A slot the old instance already sent must enter the
      // rehydrated entry in a terminal state (or, when that is every slot,
      // must not be rehydrated at all) — otherwise the re-armed safety timer
      // covers it and flushes a synthetic in-character timeout to a user who
      // already has the real reply.
      const { remainingDeliveries, alreadyDeliveredCount, deliveredTrustedToStreamCount } =
        await applyAlreadyDeliveredMarkers(runtimeSlots, deferredDeliveries, jobId =>
          this.deps.persistence.isSlotDelivered(jobId)
        );
      // Single derivation site for the five per-slot counters, run AFTER the
      // marker pass so an already-delivered slot lands in
      // `slotsAlreadyDelivered` only — never also under the poll outcome whose
      // delivery the pass just dropped. Counted before both discard branches
      // below, so a slot the age gate throws away still reports the outcome
      // recovery resolved for it.
      //
      // The trusted-to-stream count is netted the same way: `buildRuntimeSlots`
      // counted it before the marker pass, and the pass can flag one of those
      // slots delivered (a state-poll error reads as `inFlight` too), so the
      // pass's own tally of that overlap comes back out here.
      // Named rather than computed at each use: every counter and log line that
      // reports trusted-to-stream must report the SAME netted number, and an
      // inline subtraction at one site is how the other site drifts.
      const netTrustedToStreamCount = entryTrustedToStreamCount - deliveredTrustedToStreamCount;
      const entryCounts = tallyEntrySlots(
        stats,
        remainingDeliveries,
        netTrustedToStreamCount,
        alreadyDeliveredCount
      );

      // The jobIds a PRIOR run genuinely sent to Discord — the only ones a
      // discard is allowed to confirm. `alreadyDelivered` is set exclusively by
      // `applyAlreadyDeliveredMarkers`, and only when `isSlotDelivered` returned
      // true for that jobId, so a slot that was never sent cannot appear here.
      // `'timedout'` slots are excluded for the reason `deliverGroup`'s own
      // confirm fan-out excludes them: ai-worker never wrote a JobResult row for
      // a synthesized timeout, making the confirm a guaranteed 404.
      const deliveredJobIds = runtimeSlots
        .filter(s => s.alreadyDelivered === true && s.status !== 'timedout')
        .map(s => s.jobId);

      if (runtimeSlots.every(s => s.alreadyDelivered === true)) {
        // Nothing left that can produce output: clean the entry up instead of
        // adopting it. Runs before the Discord fetches for the same reason the
        // age gate does — a boot resolving several of these must not spend two
        // API calls per entry it is about to delete.
        await this.discardEntry(
          snapshot,
          'every slot already delivered by a prior run',
          stats,
          deliveredJobIds
        );
        return;
      }

      if (
        await this.discardIfExpired(
          snapshot,
          remainingDeliveries,
          netTrustedToStreamCount,
          stats,
          deliveredJobIds
        )
      ) {
        return;
      }

      // Discord fetches run AFTER the age gate: a boot recovering several
      // zombie groups (the incident class) must not spend two Discord API
      // calls per entry it's about to throw away — recovery is sequential
      // precisely to respect rate limits after heavy-traffic shutdowns.
      const targets = await this.resolveDeliveryTargets(snapshot, stats, deliveredJobIds);
      if (targets === null) {
        return;
      }
      const { channel, sourceMessage } = targets;

      const userMessageTime = new Date(snapshot.userMessageTime);
      const { timeoutHandle, remainingBudgetMs } = this.armSafetyTimer(snapshot);

      const entry: RuntimeEntry = {
        groupId: snapshot.groupId,
        sourceMessageId: snapshot.sourceMessageId,
        message: sourceMessage,
        channel,
        guildId: snapshot.guildId,
        clientId: sourceMessage.client.user?.id,
        userId: snapshot.userId,
        userMessageTime,
        userMessageContent: snapshot.userMessageContent,
        slots: runtimeSlots,
        createdAt: snapshot.createdAt,
        timeoutHandle,
        truncated: snapshot.truncated,
        maxTags: snapshot.maxTags,
      };

      // Adopt: coordinator wires the in-memory state. The jobToGroup map
      // is populated here, which is the precondition for handleJobResult
      // to find the slot via its jobId in the deferred-delivery loop below.
      await this.deps.coordinator.adoptRehydratedEntry(entry);

      // Dispatch any deferred deliveries (completed / failed / unrecoverable
      // results from the prior process). Each call routes through the same
      // entrypoint live results use — including the flush trigger when all
      // slots in the group reach terminal state, and the per-call
      // updateEntry persistence write inside handleJobResult itself. No
      // explicit updateEntry needed at this layer.
      //
      // **Idempotency**: slots a prior run already delivered were dropped from
      // this list by `applyAlreadyDeliveredMarkers` above, so nothing here can
      // re-dispatch a message the user has already seen.
      await dispatchDeferredDeliveries(snapshot.groupId, remainingDeliveries, (jobId, result) =>
        this.deps.coordinator.handleJobResult(jobId, result)
      );

      stats.entriesResumed++;
      logger.info(
        {
          groupId: snapshot.groupId,
          channelId: snapshot.channelId,
          ...entryCounts,
          remainingBudgetMs,
        },
        'Multi-tag entry rehydrated'
      );
    } catch (err) {
      logger.error(
        { err, groupId: snapshot.groupId },
        'Recovery failed for entry — leaving Redis state alone, will retry on next startup'
      );
    }
  }

  /**
   * Rebuild one slot. For pending slots: poll BullMQ for authoritative
   * state and dispatch on the outcome. For already-terminal slots in the
   * snapshot: preserve as-is (the result was never persisted in the
   * snapshot, so the slot flushes via `deliverError`'s synthetic-error
   * path — same as the prior implementation).
   *
   * Returns a `RuntimeSlot` plus an optional `deferredDelivery` — the
   * `LLMGenerationResult` to feed through `coordinator.handleJobResult`
   * AFTER `adoptRehydratedEntry` registers the entry. Delivery is
   * deferred (not pre-seeded on the slot) so the slot's transition to
   * terminal travels the same canonical path live results travel.
   */
  private async rebuildSlot(
    slotSnap: SlotSnapshot,
    entrySnap: CoordinatorEntrySnapshot,
    stats: RecoveryStats
  ): Promise<{ slot: RuntimeSlot; deferredDelivery?: DeferredDelivery }> {
    // Hoisted from the per-branch lookups in the old resubmit implementation:
    // both the terminal-snapshot path and the pending-poll path need the
    // personality (for displayName/id rendering during deliverGroup), so
    // looking it up unconditionally collapses two near-duplicate calls
    // into one. Recovery is rare enough that the extra lookup for an
    // already-revoked terminal slot is acceptable.
    const personality = await this.lookupPersonalityWithFallback(slotSnap, entrySnap.userId);

    // Already-terminal slots in the snapshot: preserve. No state poll, no
    // deferred delivery — the snapshot status is the source of truth here
    // and the slot will flush via the existing deliverError path (the
    // snapshot doesn't carry `result`, so an "errored" or "completed"
    // slot from the snapshot becomes a fallback-error in the flushed
    // burst — same as the prior implementation; this is not a regression).
    if (slotSnap.status !== 'pending') {
      const personaId = this.personaIdForSlot(slotSnap);
      if (personality === null) {
        stats.slotsAccessRevoked++;
        return { slot: this.buildRevokedSlot(slotSnap, personaId) };
      }
      return { slot: this.buildPreservedTerminalSlot(slotSnap, personality, personaId) };
    }

    // Pending slot with revoked personality: still keep the slot (with
    // sentinel personality) so the group flushes a fallback error in that
    // position. No state poll needed — even if the prior job completed
    // successfully, we can't render the result without the personality.
    if (personality === null) {
      stats.slotsAccessRevoked++;
      return { slot: this.buildRevokedSlot(slotSnap, this.personaIdForSlot(slotSnap)) };
    }

    // Pending slot, personality accessible. The persona is read from the
    // snapshot (sync, no DB), so only the BullMQ state poll is awaited.
    const personaId = this.personaIdForSlot(slotSnap);
    const outcome = await pollPriorJobState(this.deps.queue, slotSnap.jobId);
    const baseSlot: RuntimeSlot = {
      slotIndex: slotSnap.slotIndex,
      personality,
      personaId,
      source: slotSnap.source,
      isAutoResponse: slotSnap.isAutoResponse,
      jobId: slotSnap.jobId,
      status: 'pending',
    };

    switch (outcome.kind) {
      case 'completed':
        return {
          slot: baseSlot,
          deferredDelivery: {
            jobId: slotSnap.jobId,
            result: outcome.result,
            kind: 'recoveredCompleted',
          },
        };
      case 'failed':
        return {
          slot: baseSlot,
          deferredDelivery: {
            jobId: slotSnap.jobId,
            result: synthesizeFailureResult(slotSnap, outcome.failedReason),
            kind: 'recoveredFailed',
          },
        };
      case 'inFlight':
        return { slot: baseSlot };
      case 'unrecoverable':
        return {
          slot: baseSlot,
          deferredDelivery: {
            jobId: slotSnap.jobId,
            result: synthesizeFailureResult(slotSnap, 'Result unavailable after restart'),
            kind: 'unrecoverable',
          },
        };
    }
  }

  /**
   * Arm the rehydrated entry's safety timer. The timer preserves the
   * group's ORIGINAL deadline (createdAt + coordinator budget) instead of
   * granting a fresh full window: a restart must not extend how long a
   * wedged slot can block the channel's ordered delivery. A job the old
   * worker died holding looks 'inFlight' at rehydration (its BullMQ lock
   * outlives boot), so the honest budget is whatever the group had left —
   * a genuinely-slow job keeps exactly the time it would have had without
   * the restart. Floored (RECOVERY_TIMER_FLOOR_MS) so adoption + deferred
   * deliveries always get room to finish.
   *
   * **Safe-against-adoption-throw**: this timer is armed BEFORE
   * `adoptRehydratedEntry` runs. If adoption throws, the timer still
   * fires — but `handleSafetyTimeout` has an `if (entry === undefined)
   * return` guard at its top, so it becomes a no-op for unregistered
   * groupIds. No leak, no stray errors.
   */
  private armSafetyTimer(snapshot: CoordinatorEntrySnapshot): {
    timeoutHandle: NodeJS.Timeout;
    remainingBudgetMs: number;
  } {
    const remainingBudgetMs = Math.max(
      RECOVERY_TIMER_FLOOR_MS,
      MULTI_TAG.COORDINATOR_TIMEOUT_MS - (Date.now() - snapshot.createdAt)
    );
    const timeoutHandle = setTimeout(() => {
      void this.deps.coordinator.handleSafetyTimeoutPublic(snapshot.groupId).catch(err => {
        logger.error(
          { err, groupId: snapshot.groupId },
          'Recovery safety timeout handler threw unexpectedly'
        );
      });
    }, remainingBudgetMs);
    return { timeoutHandle, remainingBudgetMs };
  }

  /**
   * Resolve the Discord channel + source message an entry delivers to.
   * Either failure means the user can't be delivered to; the entry is
   * discarded cleanly and null is returned (caller stops processing it).
   *
   * `deliveredJobIds` is forwarded to the discard so a mixed entry — a slot a
   * prior run already sent alongside one still pending — still confirms the
   * delivered slot when the channel or source message has since vanished.
   */
  private async resolveDeliveryTargets(
    snapshot: CoordinatorEntrySnapshot,
    stats: RecoveryStats,
    deliveredJobIds: string[]
  ): Promise<{ channel: TypingChannel; sourceMessage: Message } | null> {
    const channel = await this.fetchTypingChannel(snapshot.channelId);
    if (channel === null) {
      await this.discardEntry(snapshot, 'channel unavailable', stats, deliveredJobIds);
      return null;
    }
    const sourceMessage = await this.fetchSourceMessage(channel, snapshot.sourceMessageId);
    if (sourceMessage === null) {
      await this.discardEntry(snapshot, 'source message unavailable', stats, deliveredJobIds);
      return null;
    }
    return { channel, sourceMessage };
  }

  /**
   * Age gate: an entry older than the coordinator's own safety window is
   * adopted only when it carries a REAL recovered result. If the old
   * instance were alive it would already have safety-flushed this group,
   * so a still-pending slot here is wedged (e.g. a parent job whose
   * children died with an earlier worker) — re-arming the timer just
   * schedules a synthetic in-character timeout error long after the user
   * moved on, while the per-channel ordering hold blocks newer turns'
   * deliveries. Completed results still deliver (late-but-real is the
   * point of recovery); late errors alone are pure noise — deliberately
   * including REAL recovered failures (an authoritative failedReason is
   * still an error the user stopped waiting for 18+ minutes ago). Gated at
   * the ENTRY level: once a completed result justifies adoption, sibling
   * slots' real failures deliver alongside it — an accurate failure isn't
   * noise when the group is flushing anyway.
   *
   * Returns true when the entry was discarded (caller stops processing it).
   * An aged entry can still hold a slot a prior run delivered (delivered A +
   * wedged B), so `deliveredJobIds` is forwarded to the discard for A's
   * delivery confirmation.
   */
  private async discardIfExpired(
    snapshot: CoordinatorEntrySnapshot,
    deferredDeliveries: DeferredDelivery[],
    trustedToStreamCount: number,
    stats: RecoveryStats,
    deliveredJobIds: string[]
  ): Promise<boolean> {
    const entryAgeMs = Date.now() - snapshot.createdAt;
    // `deferredDeliveries` here is the SURVIVING list — the already-delivered
    // pass has already dropped every slot the prior run sent. So a completed
    // slot the user was already served does not satisfy the exception: it is
    // evidence the old instance got that far, not evidence that a sibling
    // still sitting pending is live rather than wedged. The gate's own
    // reasoning applies unchanged to that sibling. Pinned by "an
    // already-delivered completed slot does not keep an ancient entry alive
    // for its still-pending sibling" in `MultiTagRecovery.test.ts`.
    const hasRecoveredResult = deferredDeliveries.some(d => d.kind === 'recoveredCompleted');
    if (entryAgeMs <= MULTI_TAG.COORDINATOR_TIMEOUT_MS || hasRecoveredResult) {
      return false;
    }
    stats.entriesExpiredSilent++;
    logger.warn(
      {
        groupId: snapshot.groupId,
        entryAgeMs,
        trustedToStream: trustedToStreamCount,
        deferredKinds: deferredDeliveries.map(d => d.kind),
      },
      'Multi-tag entry expired past the safety window with no recoverable result — resolving silently'
    );
    await this.discardEntry(
      snapshot,
      'expired past safety window, no recoverable result',
      stats,
      deliveredJobIds
    );
    return true;
  }

  /**
   * Build a runtime slot for an already-terminal snapshot slot. The
   * snapshot doesn't carry `result`, so the flushed burst will produce a
   * fallback error message for this slot via the existing deliverError
   * path. The `personaId` comes from the snapshot (`personaIdForSlot`, see
   * `rebuildSlot`), so persistence of the synthetic error message succeeds
   * against the `personas.id` FK in the typical case.
   */
  private buildPreservedTerminalSlot(
    slotSnap: SlotSnapshot,
    personality: LoadedPersonality,
    personaId: string
  ): RuntimeSlot {
    return {
      slotIndex: slotSnap.slotIndex,
      personality,
      personaId,
      source: slotSnap.source,
      isAutoResponse: slotSnap.isAutoResponse,
      jobId: slotSnap.jobId,
      status: slotSnap.status,
    };
  }

  /**
   * Build a sentinel slot for a personality that's no longer accessible
   * (deleted, ownership revoked, etc.). Status is forced to `'errored'`
   * so the group flushes a fallback error message in that position rather
   * than silently dropping the slot. The `personaId` comes from the snapshot
   * (`personaIdForSlot`, see `rebuildSlot`), so the synthetic error message
   * persists against a real `personas.id` FK in the typical case — the user's
   * conversation history records the "couldn't reach this personality" entry
   * under their own persona.
   */
  private buildRevokedSlot(slotSnap: SlotSnapshot, personaId: string): RuntimeSlot {
    return {
      slotIndex: slotSnap.slotIndex,
      personality: buildSentinelPersonality(slotSnap),
      personaId,
      source: slotSnap.source,
      isAutoResponse: slotSnap.isAutoResponse,
      jobId: slotSnap.jobId,
      status: 'errored',
    };
  }

  /**
   * The persona UUID to persist a recovered slot's assistant message against.
   * Read from the SNAPSHOT (captured at fan-out time by `toSnapshot`) rather
   * than re-resolved: recovery must not touch Prisma, and the fan-out-time
   * persona is the historically-correct attribution — re-resolving now would
   * mis-attribute to the user's CURRENT persona if it changed while the bot was
   * down.
   *
   * Falls back to a synthetic string when the snapshot carries no real persona:
   * a system-default summon (`personaId === ''`) or a legacy snapshot predating
   * the field (`personaId === undefined`, in-flight at the deploy that added
   * it). The `saveAssistantMessage` try/catch in deliverSuccess/deliverError
   * swallows the resulting FK violation so the slot still delivers — the user
   * gets their message; history just doesn't persist for that rare case.
   */
  private personaIdForSlot(slotSnap: SlotSnapshot): string {
    const personaId = slotSnap.personaId;
    if (personaId !== undefined && personaId.length > 0) {
      return personaId;
    }
    // Log only the legacy-snapshot case (no field at all) — that's the
    // deploy-window canary worth watching. The `''` system-default case is a
    // normal summon and would be noise. No PII: jobId + slug only.
    if (personaId === undefined) {
      logger.debug(
        { jobId: slotSnap.jobId, personalitySlug: slotSnap.personalitySlug },
        'Recovery: snapshot carries no personaId (predates the field); using synthetic fallback'
      );
    }
    return `recovery-fallback-${slotSnap.personalitySlug}`;
  }

  private async fetchTypingChannel(channelId: string): Promise<TypingChannel | null> {
    return fetchTypingChannel(this.deps.discordClient, channelId);
  }

  private async fetchSourceMessage(
    channel: TypingChannel,
    messageId: string
  ): Promise<Message | null> {
    try {
      return await channel.messages.fetch(messageId);
    } catch (err) {
      logger.warn(
        { err, channelId: channel.id, messageId },
        'Recovery: source message fetch failed'
      );
      return null;
    }
  }

  /**
   * Load a personality by its snapshot slug or ID, treating any throw as
   * "personality access revoked." Returns null on either result-null
   * (access denied / not found) or exception.
   *
   * **About the `nameOrId` arg**: `IPersonalityLoader.loadPersonality`
   * accepts `nameOrId: string` and detects UUID-vs-name via regex
   * internally — so passing either a slug or an ID is the supported path.
   */
  private async loadPersonalityOrErrored(
    nameOrId: string,
    userId: string
  ): Promise<LoadedPersonality | null> {
    try {
      return await this.deps.personalityService.loadPersonality(nameOrId, userId);
    } catch (err) {
      logger.warn(
        { err, nameOrId, userId },
        'Recovery: personality load threw — treating as revoked'
      );
      return null;
    }
  }

  /**
   * Try ID first (stable, UUID), fall back to slug (mutable — can be
   * renamed). Snapshots carry both, and IDs survive slug renames between
   * snapshot-write and recovery-read. Without this fallback ordering, a
   * personality whose slug was renamed mid-fan-out would be treated as
   * access-revoked even though it's still reachable by ID.
   */
  private async lookupPersonalityWithFallback(
    slotSnap: SlotSnapshot,
    userId: string
  ): Promise<LoadedPersonality | null> {
    const byId = await this.loadPersonalityOrErrored(slotSnap.personalityId, userId);
    if (byId !== null) {
      return byId;
    }
    return this.loadPersonalityOrErrored(slotSnap.personalitySlug, userId);
  }

  /**
   * Thin delegation to `discardRecoveredEntry`, which owns the stale-mark +
   * delivery-confirm + snapshot-delete sequence. Kept as a method so every
   * discard site in this class reads the same as before.
   */
  private async discardEntry(
    snapshot: CoordinatorEntrySnapshot,
    reason: string,
    stats: RecoveryStats,
    deliveredJobIds: string[]
  ): Promise<void> {
    await discardRecoveredEntry({
      persistence: this.deps.persistence,
      snapshot,
      reason,
      stats,
      deliveredJobIds,
    });
  }
}
