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
 *      - For each terminal slot in the snapshot: preserve as-is (the result
 *        was never persisted in the snapshot, so the slot will flush as an
 *        error via the existing `deliverError` path — same as before).
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
  pollPriorJobState,
  synthesizeFailureResult,
  type DeferredDelivery,
  type RecoveryStats,
} from './multiTagRecoveryHelpers.js';

const logger = createLogger('MultiTagRecovery');

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
      //
      // Track inFlight slot count locally during the loop rather than
      // re-deriving from `runtimeSlots` post-`handleJobResult`. The
      // derive-from-slot-status approach is load-bearing on the
      // coordinator mutating slot objects in place when delivering — it
      // works today (see `MultiTagCoordinator.handleJobResult`), but
      // counting here keeps the per-entry log independent of that
      // implementation detail. A slot enters this count iff its outcome
      // was `inFlight` (returns a pending base slot with no deferred
      // delivery); revoked/terminal slots don't qualify.
      const runtimeSlots: RuntimeSlot[] = [];
      const deferredDeliveries: DeferredDelivery[] = [];
      let entryTrustedToStreamCount = 0;
      for (const slotSnap of snapshot.slots) {
        const { slot, deferredDelivery } = await this.rebuildSlot(slotSnap, snapshot, stats);
        runtimeSlots.push(slot);
        if (deferredDelivery !== undefined) {
          deferredDeliveries.push(deferredDelivery);
        } else if (slot.status === 'pending') {
          entryTrustedToStreamCount++;
        }
      }

      if (runtimeSlots.length === 0) {
        // Defense-in-depth: `parseSnapshotOrLog` validates `slots.length > 0`
        // at parse time, so this branch should be unreachable. Kept as a
        // floor against future schema/validation drift — a malformed
        // snapshot with zero slots shouldn't crash recovery.
        await this.discardEntry(snapshot, 'snapshot has zero slots', stats);
        return;
      }

      if (
        await this.discardIfExpired(snapshot, deferredDeliveries, entryTrustedToStreamCount, stats)
      ) {
        return;
      }

      // Discord fetches run AFTER the age gate: a boot recovering several
      // zombie groups (the incident class) must not spend two Discord API
      // calls per entry it's about to throw away — recovery is sequential
      // precisely to respect rate limits after heavy-traffic shutdowns.
      const targets = await this.resolveDeliveryTargets(snapshot, stats);
      if (targets === null) {
        return;
      }
      const { channel, sourceMessage } = targets;

      // Build runtime entry. Safety timer is re-armed from rehydrate time
      // (giving any genuinely-in-flight jobs the full timeout budget)
      // rather than counting against the original createdAt.
      //
      // **Safe-against-adoption-throw**: this timer is armed BEFORE
      // `adoptRehydratedEntry` runs below. If adoption throws, the timer
      // still fires after COORDINATOR_TIMEOUT_MS — but `handleSafetyTimeout`
      // has an `if (entry === undefined) return` guard at its top, so it
      // becomes a no-op for unregistered groupIds. No leak, no stray errors.
      const userMessageTime = new Date(snapshot.userMessageTime);
      const timeoutHandle = setTimeout(() => {
        void this.deps.coordinator.handleSafetyTimeoutPublic(snapshot.groupId).catch(err => {
          logger.error(
            { err, groupId: snapshot.groupId },
            'Recovery safety timeout handler threw unexpectedly'
          );
        });
      }, MULTI_TAG.COORDINATOR_TIMEOUT_MS);

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
      // **Idempotency**: `multiTagDeliveryFlow.deliverSlot` writes a per-slot
      // `slot-delivered:{jobId}` marker after every successful Discord send.
      // Checking it here closes the narrow crash window where a prior recovery
      // run delivered the slot but crashed before `deleteEntry` ran (the
      // entry-snapshot still shows the flush-trigger slot as pending, the
      // BullMQ job is completed, and without the marker this loop would
      // re-dispatch → duplicate user-visible message). Two awaits across the
      // bus rather than one, paid only on the recovery path which is rare.
      //
      // Per-delivery try/catch: a throw from one `handleJobResult` must
      // not block subsequent deliveries in the same entry. The narrow
      // failure shape today is `handleJobResult` itself throwing on its
      // inner `updateEntry` persistence write (handler is otherwise
      // robust), but the cost of the guard is negligible and the
      // resilience matches the per-slot catch in `multiTagDeliveryFlow.deliverSlot`.
      for (const delivery of deferredDeliveries) {
        try {
          if (await this.deps.persistence.isSlotDelivered(delivery.jobId)) {
            logger.info(
              { groupId: snapshot.groupId, jobId: delivery.jobId, kind: delivery.kind },
              'Recovery: slot already delivered by a prior run — skipping dispatch'
            );
            stats.slotsAlreadyDelivered++;
            continue;
          }
          await this.deps.coordinator.handleJobResult(delivery.jobId, delivery.result);
        } catch (err) {
          logger.error(
            {
              err,
              jobId: delivery.jobId,
              groupId: snapshot.groupId,
              kind: delivery.kind,
            },
            'Recovery: deferred-delivery dispatch threw — continuing with remaining slots'
          );
        }
      }

      stats.entriesResumed++;
      logger.info(
        {
          groupId: snapshot.groupId,
          channelId: snapshot.channelId,
          slotsRecoveredCompleted: deferredDeliveries.filter(d => d.kind === 'recoveredCompleted')
            .length,
          slotsRecoveredFailed: deferredDeliveries.filter(d => d.kind === 'recoveredFailed').length,
          slotsUnrecoverable: deferredDeliveries.filter(d => d.kind === 'unrecoverable').length,
          slotsTrustedToStream: entryTrustedToStreamCount,
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
        stats.slotsRecoveredCompleted++;
        return {
          slot: baseSlot,
          deferredDelivery: {
            jobId: slotSnap.jobId,
            result: outcome.result,
            kind: 'recoveredCompleted',
          },
        };
      case 'failed':
        stats.slotsRecoveredFailed++;
        return {
          slot: baseSlot,
          deferredDelivery: {
            jobId: slotSnap.jobId,
            result: synthesizeFailureResult(slotSnap, outcome.failedReason),
            kind: 'recoveredFailed',
          },
        };
      case 'inFlight':
        stats.slotsTrustedToStream++;
        return { slot: baseSlot };
      case 'unrecoverable':
        stats.slotsUnrecoverable++;
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
   * Resolve the Discord channel + source message an entry delivers to.
   * Either failure means the user can't be delivered to; the entry is
   * discarded cleanly and null is returned (caller stops processing it).
   */
  private async resolveDeliveryTargets(
    snapshot: CoordinatorEntrySnapshot,
    stats: RecoveryStats
  ): Promise<{ channel: TypingChannel; sourceMessage: Message } | null> {
    const channel = await this.fetchTypingChannel(snapshot.channelId);
    if (channel === null) {
      await this.discardEntry(snapshot, 'channel unavailable', stats);
      return null;
    }
    const sourceMessage = await this.fetchSourceMessage(channel, snapshot.sourceMessageId);
    if (sourceMessage === null) {
      await this.discardEntry(snapshot, 'source message unavailable', stats);
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
   */
  private async discardIfExpired(
    snapshot: CoordinatorEntrySnapshot,
    deferredDeliveries: DeferredDelivery[],
    trustedToStreamCount: number,
    stats: RecoveryStats
  ): Promise<boolean> {
    const entryAgeMs = Date.now() - snapshot.createdAt;
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
    await this.discardEntry(snapshot, 'expired past safety window, no recoverable result', stats);
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
      personality: this.buildSentinelPersonality(slotSnap),
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
   * shape would be cleaner; tracked in backlog/cold/follow-ups.md.
   */
  private buildSentinelPersonality(slotSnap: SlotSnapshot): LoadedPersonality {
    return {
      id: slotSnap.personalityId,
      slug: slotSnap.personalitySlug,
      displayName: slotSnap.personalitySlug,
      name: slotSnap.personalitySlug,
    } as unknown as LoadedPersonality;
  }

  /**
   * Discard an unrecoverable entry: mark every pending jobId stale (so
   * post-recovery arrivals are dropped), then delete the Redis snapshot.
   * Best-effort — log on failure but don't throw.
   */
  private async discardEntry(
    snapshot: CoordinatorEntrySnapshot,
    reason: string,
    stats: RecoveryStats
  ): Promise<void> {
    const pendingJobIds = snapshot.slots.filter(s => s.status === 'pending').map(s => s.jobId);
    if (pendingJobIds.length > 0) {
      try {
        await this.deps.persistence.markStale(...pendingJobIds);
        stats.staleJobIdsMarked += pendingJobIds.length;
      } catch (err) {
        logger.warn(
          { err, groupId: snapshot.groupId },
          'Recovery: failed to mark stale during entry discard'
        );
      }
    }
    try {
      await this.deps.persistence.deleteEntry(snapshot);
    } catch (err) {
      logger.warn({ err, groupId: snapshot.groupId }, 'Recovery: failed to delete discarded entry');
    }
    stats.entriesDiscarded++;
    logger.info(
      { groupId: snapshot.groupId, channelId: snapshot.channelId, reason },
      'Multi-tag entry discarded during recovery'
    );
  }
}
