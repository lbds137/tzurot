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
 *      - Fetch Discord channel + source message. If either fails (channel
 *        deleted, message deleted), discard the entry — the user can't be
 *        delivered to anyway.
 *      - For each pending slot: poll BullMQ for the OLD job's authoritative
 *        state via `queue.getJob().getState()`. Routes:
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

import type { Client, Message, Channel } from 'discord.js';
import type { Queue } from 'bullmq';
import {
  createLogger,
  isTypingChannel,
  type LLMGenerationResult,
  type LoadedPersonality,
  type PersonaResolver,
  type TypingChannel,
  MULTI_TAG,
} from '@tzurot/common-types';
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
  type SlotStateOutcome,
} from './multiTagRecoveryHelpers.js';

const logger = createLogger('MultiTagRecovery');

export interface MultiTagRecoveryDeps {
  persistence: MultiTagPersistence;
  coordinator: MultiTagCoordinator;
  personalityService: IPersonalityLoader;
  personaResolver: PersonaResolver;
  discordClient: Client;
  /**
   * BullMQ queue handle for the AI-requests queue. Used to poll the
   * authoritative state (`completed | failed | active | ...`) of jobs that
   * were in flight when the bot last shut down. Constructed in
   * `index.ts`'s composition root and closed in the shutdown sequence.
   */
  queue: Queue;
}

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
}

interface DeferredDelivery {
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

export class MultiTagRecovery {
  constructor(private readonly deps: MultiTagRecoveryDeps) {}

  async run(): Promise<RecoveryStats> {
    const stats: RecoveryStats = {
      entriesScanned: 0,
      entriesResumed: 0,
      entriesDiscarded: 0,
      slotsRecoveredCompleted: 0,
      slotsRecoveredFailed: 0,
      slotsTrustedToStream: 0,
      slotsUnrecoverable: 0,
      slotsAccessRevoked: 0,
      staleJobIdsMarked: 0,
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
      // Resolve Discord channel + source message. Either failure means we
      // can't deliver to the user; discard cleanly.
      const channel = await this.fetchTypingChannel(snapshot.channelId);
      if (channel === null) {
        await this.discardEntry(snapshot, 'channel unavailable', stats);
        return;
      }
      const sourceMessage = await this.fetchSourceMessage(channel, snapshot.sourceMessageId);
      if (sourceMessage === null) {
        await this.discardEntry(snapshot, 'source message unavailable', stats);
        return;
      }

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
      // **Non-idempotency window**: if the process crashes between two
      // successive `handleJobResult` calls in this loop, the next recovery
      // run can re-dispatch the same already-delivered result. Whether
      // the user sees a duplicate Discord message depends on
      // `handleJobResult`'s persistence timing — if updateEntry runs
      // before the user-visible send (current behavior in non-flush
      // cases), the re-dispatch sees terminal status and skips; the
      // all-terminal flush path deletes the entry, so a crash there
      // means recovery is already done. The behavior is "potentially
      // duplicate message" rather than "no message" — the better
      // failure mode — and the exposure window is tiny (only between
      // two awaits within recovery itself). Idempotent re-dispatch is
      // tracked as a follow-up; see backlog/deferred.md.
      for (const delivery of deferredDeliveries) {
        await this.deps.coordinator.handleJobResult(delivery.jobId, delivery.result);
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

    // See `resolvePersonaIdOrFallback` JSDoc for cascade semantics and
    // the synthetic-fallback safety net.
    const personaId = await this.resolvePersonaIdOrFallback(
      entrySnap.userId,
      personality?.id ?? slotSnap.personalityId,
      slotSnap.personalitySlug
    );

    // Already-terminal slots in the snapshot: preserve. No state poll, no
    // deferred delivery — the snapshot status is the source of truth here
    // and the slot will flush via the existing deliverError path (the
    // snapshot doesn't carry `result`, so an "errored" or "completed"
    // slot from the snapshot becomes a fallback-error in the flushed
    // burst — same as the prior implementation; this is not a regression).
    if (slotSnap.status !== 'pending') {
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
      return { slot: this.buildRevokedSlot(slotSnap, personaId) };
    }

    // Pending slot, personality accessible: poll BullMQ for the old job's
    // authoritative state.
    const outcome: SlotStateOutcome = await pollPriorJobState(this.deps.queue, slotSnap.jobId);
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
   * Build a runtime slot for an already-terminal snapshot slot. The
   * snapshot doesn't carry `result`, so the flushed burst will produce a
   * fallback error message for this slot via the existing deliverError
   * path. The `personaId` is resolved via `PersonaResolver` upstream
   * (see `rebuildSlot`), so persistence of the synthetic error message
   * succeeds against the `personas.id` FK in the typical case.
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
   * than silently dropping the slot. The `personaId` is resolved via
   * `PersonaResolver` upstream (see `rebuildSlot`), so the synthetic
   * error message persists against a real `personas.id` FK in the
   * typical case — the user's conversation history records the
   * "couldn't reach this personality" entry under their own persona.
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
   * Resolve a real `personas.id` UUID for the slot via the PersonaResolver
   * cascade (per-personality override → user default → first-owned-persona).
   * Returns the resolved UUID, or a synthetic-string fallback when the
   * cascade returns null (user has zero personas at all) OR the resolver
   * call throws (transient Prisma blip). The synthetic-fallback path
   * keeps the slot deliverable — the `saveAssistantMessage` try/catch
   * in both deliverSuccess and deliverError swallows the FK violation
   * so the user still gets their message, history just doesn't persist.
   *
   * `fallbackSlug` is passed separately rather than derived from a
   * `SlotSnapshot` argument because the synthetic-fallback string is
   * the only thing the function needs from the slot; threading the full
   * snapshot would be a leaky boundary.
   */
  private async resolvePersonaIdOrFallback(
    discordUserId: string,
    personalityId: string,
    fallbackSlug: string
  ): Promise<string> {
    try {
      const memoryInfo = await this.deps.personaResolver.resolveForMemory(
        discordUserId,
        personalityId
      );
      if (memoryInfo !== null) {
        return memoryInfo.personaId;
      }
      logger.warn(
        { discordUserId, personalityId },
        'Recovery: PersonaResolver returned null (user has no personas); falling back to synthetic personaId'
      );
    } catch (err) {
      logger.warn(
        { err, discordUserId, personalityId },
        'Recovery: PersonaResolver threw; falling back to synthetic personaId'
      );
    }
    return `recovery-fallback-${fallbackSlug}`;
  }

  private async fetchTypingChannel(channelId: string): Promise<TypingChannel | null> {
    try {
      const channel: Channel | null = await this.deps.discordClient.channels.fetch(channelId);
      if (channel === null) {
        return null;
      }
      // `isTypingChannel` expects a Message['channel']-typed value but the
      // type guard's predicate works structurally — cast through unknown.
      if (!isTypingChannel(channel as unknown as Message['channel'])) {
        return null;
      }
      return channel as unknown as TypingChannel;
    } catch (err) {
      logger.warn({ err, channelId }, 'Recovery: channel fetch failed');
      return null;
    }
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
   * shape would be cleaner; tracked in backlog/deferred.md.
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
