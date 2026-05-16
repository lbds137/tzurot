/**
 * MultiTagRecovery — startup hook that rehydrates in-flight multi-tag
 * fan-outs after a bot restart.
 *
 * **Why this exists**: when the bot shuts down (graceful or crash), pending
 * multi-tag fan-outs leave Redis entries behind. Without recovery, those
 * entries' old jobIds would never produce user-visible responses — and on
 * the next restart, the SET-of-stale-jobIds would block delivery for any
 * jobs that DID return between shutdown and restart. The
 * `beginShutdown` path (MultiTagCoordinator) marks pending jobIds stale so
 * pre-restart results get discarded; this service does the converse —
 * resubmits fresh jobs for those slots so the user eventually sees a
 * response.
 *
 * **Algorithm** (run BEFORE ResultsListener starts):
 *   1. Scan `multitag:entry:*` Redis keys via `MultiTagPersistence.scanAllEntries`.
 *   2. For each snapshot:
 *      - Fetch Discord channel + source message. If either fails (channel
 *        deleted, message deleted), discard the entry — the user can't be
 *        delivered to anyway.
 *      - For each pending slot: mark old jobId stale, load personality
 *        (may be revoked), resubmit chat job, replace jobId in snapshot.
 *      - For each terminal slot: leave as-is (it'll flush along with the
 *        last pending slot's completion).
 *      - Adopt the rehydrated runtime entry into the coordinator's
 *        in-memory maps + register with orderingService.
 *      - Persist the updated snapshot back to Redis with new jobIds.
 *   3. Notify coordinator that stale jobIds exist (flips the
 *      `staleCheckNeeded` fast-path flag) so MessageHandler runs the
 *      isStale check post-recovery.
 *
 * **Critical ordering**: `run()` MUST complete before `ResultsListener.start()`.
 * The stale-set filter is what makes pre-restart-jobId results safe to
 * discard; without it, an old result could arrive during recovery and
 * race the rehydration.
 *
 * **Discord readiness**: callers must invoke `run()` AFTER `client.login()`
 * completes — channel/message fetches require an authenticated client.
 */

import type { Client, Message, Channel } from 'discord.js';
import {
  createLogger,
  isTypingChannel,
  type LoadedPersonality,
  type TypingChannel,
  MULTI_TAG,
} from '@tzurot/common-types';
import type { MultiTagCoordinator } from './MultiTagCoordinator.js';
import type {
  MultiTagPersistence,
  CoordinatorEntrySnapshot,
  SlotSnapshot,
} from './MultiTagPersistence.js';
import type { PersonalityChatManager } from './character/PersonalityChatManager.js';
import type { JobTracker } from './JobTracker.js';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import { toSnapshot, type RuntimeEntry, type RuntimeSlot } from './multiTagCoordinatorHelpers.js';

const logger = createLogger('MultiTagRecovery');

export interface MultiTagRecoveryDeps {
  persistence: MultiTagPersistence;
  coordinator: MultiTagCoordinator;
  chatManager: PersonalityChatManager;
  jobTracker: JobTracker;
  personalityService: IPersonalityLoader;
  discordClient: Client;
}

export interface RecoveryStats {
  entriesScanned: number;
  entriesResumed: number;
  entriesDiscarded: number;
  slotsResubmitted: number;
  slotsAccessRevoked: number;
  staleJobIdsMarked: number;
}

export class MultiTagRecovery {
  constructor(private readonly deps: MultiTagRecoveryDeps) {}

  async run(): Promise<RecoveryStats> {
    const stats: RecoveryStats = {
      entriesScanned: 0,
      entriesResumed: 0,
      entriesDiscarded: 0,
      slotsResubmitted: 0,
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
    // a chat-job resubmission per pending slot. Parallelizing across N
    // entries on a fresh bot startup would risk Discord rate limits
    // (especially after a heavy-traffic shutdown that left many in-flight
    // fan-outs) and burst the gateway/queue. Recovery is rare and runs
    // once per process; the extra wall time is acceptable.
    for (const snapshot of snapshots) {
      await this.recoverOne(snapshot, stats);
    }

    // Notify coordinator so its `staleCheckNeeded` fast-path skip-flag
    // becomes active for the rest of the process lifetime. Without this,
    // MessageHandler would skip the isStale check and could deliver
    // pre-restart results.
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

      // Build runtime slots: resubmit pending, preserve terminal. Slots
      // whose personality became inaccessible are kept as errored sentinel
      // slots (not dropped) so the group still flushes a fallback error
      // message for each position — `rebuildSlot` never returns null
      // today, so the loop just maps 1:1.
      const runtimeSlots: RuntimeSlot[] = [];
      for (const slotSnap of snapshot.slots) {
        const rebuilt = await this.rebuildSlot(slotSnap, sourceMessage, snapshot, stats);
        runtimeSlots.push(rebuilt);
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
      // (giving the resubmitted jobs the full timeout budget) rather than
      // counting against the original createdAt.
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

      // Adopt: coordinator wires the in-memory state and triggers
      // immediate flush if every slot is already terminal.
      //
      // **Capture `allTerminal` BEFORE the adopt await.** When the entry
      // has no pending slots, `adoptRehydratedEntry` calls `flushEntry`
      // → `deliverGroup` → `persistence.deleteEntry` synchronously
      // before returning. If we inspected `entry.slots` after the await,
      // we'd skip the updateEntry below correctly but the reasoning
      // would be load-bearing on coordinator-internal timing rather than
      // captured intent. Pre-capture makes the ordering explicit.
      const allTerminal = entry.slots.every(s => s.status !== 'pending');
      await this.deps.coordinator.adoptRehydratedEntry(entry);

      // Persist the updated snapshot (new jobIds in pending slots). Skip
      // when every slot was already terminal at adopt time — the immediate
      // flush triggered by adoptRehydratedEntry already called
      // deleteEntry, so writing back here would orphan a snapshot at a
      // key that's about to expire via TTL anyway.
      if (!allTerminal) {
        try {
          await this.deps.persistence.updateEntry(toSnapshot(entry));
        } catch (err) {
          logger.warn(
            { err, groupId: snapshot.groupId },
            'Failed to persist rehydrated snapshot — coordinator will continue in-memory only'
          );
        }
      }

      stats.entriesResumed++;
      logger.info(
        {
          groupId: snapshot.groupId,
          channelId: snapshot.channelId,
          slotsResubmitted: snapshot.slots.filter(s => s.status === 'pending').length,
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
   * Rebuild one slot: resubmit pending, preserve terminal. Always returns
   * a slot — when the personality is inaccessible, builds a sentinel slot
   * (errored status, sentinel personality) so the group still flushes with
   * a fallback error message for that position rather than silently
   * dropping the slot.
   */
  private async rebuildSlot(
    slotSnap: SlotSnapshot,
    sourceMessage: Message,
    entrySnap: CoordinatorEntrySnapshot,
    stats: RecoveryStats
  ): Promise<RuntimeSlot> {
    if (slotSnap.status !== 'pending') {
      // Already terminal — preserve as-is. result is NOT in the snapshot
      // (we only persist the SlotSnapshot subset); the existing slot will
      // synthesize an error in deliverGroup if result is missing, which
      // is correct for slots that completed before shutdown but never
      // got their result back from Redis.
      const personality = await this.lookupPersonalityWithFallback(slotSnap, entrySnap.userId);
      if (personality === null) {
        // Personality became inaccessible between completion and recovery.
        // Keep the slot (with sentinel personality) so the group still
        // flushes a fallback error in that position — symmetric with the
        // pending-branch handling below. Count it in stats so observers
        // can see "this many slots lost access during recovery."
        //
        // **About the synthetic `personaId`**: `personaId` is a Prisma
        // UUID FK to the `personas` table. The `recovery-revoked-*`
        // string isn't a valid UUID, so `saveAssistantMessage` would
        // hit a FK violation when SlotDeliveryService's deliverError
        // path tries to persist the synthetic error message. That's
        // acceptable degradation: `deliverError` wraps the persist call
        // in try/catch (the webhook already sent), so the user sees
        // the error message but conversation history doesn't record
        // it. The same applies to `recovery-denied-*` below. Recovery
        // could look up the user's default persona here to make
        // persistence work, but synthetic-strings + log-and-swallow
        // is acceptable for the rare access-revoked / denied edge cases.
        stats.slotsAccessRevoked++;
        return {
          slotIndex: slotSnap.slotIndex,
          personality: this.buildSentinelPersonality(slotSnap),
          personaId: `recovery-revoked-${slotSnap.personalitySlug}`,
          source: slotSnap.source,
          isAutoResponse: slotSnap.isAutoResponse,
          jobId: slotSnap.jobId,
          status: 'errored',
        };
      }
      // Same synthetic-personaId trap as the revoked branch above: result
      // is never persisted in SlotSnapshot, so recovered terminal slots
      // route through deliverError → saveAssistantMessage → FK violation
      // (caught + logged by SlotDeliveryService). User regression: a
      // pre-restart "completed" slot becomes a delivered-as-error slot on
      // the channel. Acceptable for an already-rare recovery edge case;
      // a future fix would resolve the user's default persona at recovery
      // time and use that as personaId.
      return {
        slotIndex: slotSnap.slotIndex,
        personality,
        personaId: `recovery-persona-${personality.id}`,
        source: slotSnap.source,
        isAutoResponse: slotSnap.isAutoResponse,
        jobId: slotSnap.jobId,
        status: slotSnap.status,
      };
    }

    // Pending slot: mark old jobId stale BEFORE resubmitting (closes the
    // race where the old result arrives during the resubmit roundtrip).
    await this.deps.persistence.markStale(slotSnap.jobId);
    stats.staleJobIdsMarked++;

    const personality = await this.lookupPersonalityWithFallback(slotSnap, entrySnap.userId);
    if (personality === null) {
      stats.slotsAccessRevoked++;
      // Personality access revoked since the original fan-out. Keep the
      // slot in the entry but flag it as errored so the group can still
      // flush (the error path will render a fallback message for this
      // slot).
      return {
        slotIndex: slotSnap.slotIndex,
        // Use a sentinel personality object so downstream code that
        // accesses .id/.slug/.displayName doesn't NPE. The deliverError
        // path will produce a "couldn't reach this personality" message.
        personality: this.buildSentinelPersonality(slotSnap),
        personaId: `recovery-revoked-${slotSnap.personalitySlug}`,
        source: slotSnap.source,
        isAutoResponse: slotSnap.isAutoResponse,
        jobId: slotSnap.jobId,
        status: 'errored',
      };
    }

    // Resubmit the chat job. Treat any failure (denied / network / etc.)
    // the same as access-revoked — slot becomes errored.
    const submitResult = await this.deps.chatManager.submitChatJob({
      message: sourceMessage,
      personality,
      content: entrySnap.userMessageContent,
      isAutoResponse: slotSnap.isAutoResponse,
    });
    if (submitResult.kind !== 'submitted') {
      logger.warn(
        {
          groupId: entrySnap.groupId,
          slotIndex: slotSnap.slotIndex,
          personalityId: personality.id,
          reason: submitResult.reason,
        },
        'Recovery resubmit denied — marking slot errored'
      );
      return {
        slotIndex: slotSnap.slotIndex,
        personality,
        personaId: `recovery-denied-${personality.id}`,
        source: slotSnap.source,
        isAutoResponse: slotSnap.isAutoResponse,
        jobId: slotSnap.jobId,
        status: 'errored',
      };
    }

    // Register the new jobId with JobTracker so typing indicator runs
    // and the result eventually routes back to handleJobResult.
    this.deps.jobTracker.trackJob(submitResult.jobId, submitResult.trackingContext, {
      skipOrderingRegistration: true,
    });
    stats.slotsResubmitted++;

    return {
      slotIndex: slotSnap.slotIndex,
      personality,
      personaId: submitResult.trackingContext.personaId,
      source: slotSnap.source,
      isAutoResponse: slotSnap.isAutoResponse,
      jobId: submitResult.jobId,
      status: 'pending',
    };
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
   * shape would be cleaner; deferred as out of scope for this PR.
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
