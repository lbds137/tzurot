/**
 * SingleJobRecovery — startup hook that re-adopts single-personality jobs
 * left in flight by a bot restart.
 *
 * **Why this exists**: `JobTracker` holds its slots in memory, so a restart
 * erases the delivery target of every in-flight request. The ai-worker
 * survives this fine — a stalled job is re-queued and re-run — and publishes
 * its result to the `job-results` stream, where the new bot-client's consumer
 * group picks it up. But with no tracker context the result reaches
 * `MessageHandler` as an unknown job and is discarded, so a reply that was
 * generated (and paid for) never reaches the user.
 *
 * `MultiTagRecovery` solves the same problem for fan-outs by scanning
 * `multitag:entry:*`; single-personality requests had no equivalent, which is
 * why a recovery run could report `entriesScanned=0` while a single-tag reply
 * was being dropped.
 *
 * **Algorithm** (run BEFORE `ResultsListener.start()`, AFTER `client.login()`):
 *   1. Scan `singlejob:context:*` via `SingleJobPersistence.scanAll`.
 *   2. For each context, in order — every failure discards the entry, because
 *      a context we cannot rebuild is one we can never deliver to:
 *      - **Age gate**: older than `TRACKED_JOB_MAX_LIFETIME_MS` means the
 *        tracker's own orphan sweep would already have released this slot had
 *        the process stayed up. A restart must not extend that budget.
 *      - Re-fetch the Discord channel (deleted channel / lost permissions →
 *        discard).
 *      - Re-load the personality by id, falling back to slug — ids survive a
 *        rename between the write and this read.
 *      - For a message-shaped context, re-fetch the source Message (the reply
 *        anchor the delivery path needs).
 *      - Re-adopt into `JobTracker` with the job's ORIGINAL `startTime`.
 *   3. The result then arrives on the stream and delivers through the normal
 *      path, because `JobTracker.getContext` now finds it.
 *
 * **No BullMQ state poll**, deliberately unlike `MultiTagRecovery`. That poll
 * feeds the coordinator's group-flush state machine, which has no analogue
 * here — and acting on it would be actively unsafe: a completed job can be
 * evicted from BullMQ by `removeOnComplete` while its stream entry is still
 * pending, so treating "job not found" as unrecoverable would re-introduce
 * the exact drop this module exists to prevent. Adoption is unconditional and
 * the tracker's existing orphan sweep bounds a job whose result never comes.
 *
 * **No re-dispatch of recovered results** either: the stream is the delivery
 * mechanism and it survives restarts (a consumer group re-reads unacked
 * entries). Dispatching at boot as well would need the whole
 * `slot-delivered` marker apparatus to deduplicate against it.
 *
 * **Degradation**: every Discord and personality lookup is individually
 * caught, and each entry is recovered inside its own try/catch, so no single
 * failure can throw out of startup.
 */

import type { Client, Message } from 'discord.js';
import { type TypingChannel } from '@tzurot/common-types/types/discord-types';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { fetchTypingChannel } from '../utils/fetchTypingChannel.js';
import {
  TRACKED_JOB_MAX_LIFETIME_MS,
  type JobTracker,
  type PendingJobContext,
} from './JobTracker.js';
import type { PersistedJobContext, SingleJobPersistence } from './SingleJobPersistence.js';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';

const logger = createLogger('SingleJobRecovery');

export interface SingleJobRecoveryStats {
  entriesScanned: number;
  entriesResumed: number;
  entriesDiscarded: number;
  entriesExpired: number;
}

export interface SingleJobRecoveryDeps {
  persistence: SingleJobPersistence;
  jobTracker: JobTracker;
  personalityService: IPersonalityLoader;
  discordClient: Client;
}

export class SingleJobRecovery {
  constructor(private readonly deps: SingleJobRecoveryDeps) {}

  async run(): Promise<SingleJobRecoveryStats> {
    const stats: SingleJobRecoveryStats = {
      entriesScanned: 0,
      entriesResumed: 0,
      entriesDiscarded: 0,
      entriesExpired: 0,
    };

    let contexts: PersistedJobContext[];
    try {
      contexts = await this.deps.persistence.scanAll();
    } catch (err) {
      logger.error({ err }, 'Recovery scan failed — skipping single-job recovery this startup');
      return stats;
    }

    stats.entriesScanned = contexts.length;
    if (contexts.length === 0) {
      logger.info('No single-job contexts to recover');
      return stats;
    }

    // Sequential for the same reason `MultiTagRecovery` is: each entry costs
    // up to two Discord API calls, and a boot after a heavy-traffic shutdown
    // could otherwise burst into a rate limit. Recovery runs once per process.
    for (const context of contexts) {
      await this.recoverOne(context, stats);
    }

    logger.info({ ...stats }, 'Single-job recovery complete');
    return stats;
  }

  /**
   * Recover one context. Mutates `stats`; catches its own errors so one bad
   * entry cannot poison the rest of the scan.
   */
  private async recoverOne(
    persisted: PersistedJobContext,
    stats: SingleJobRecoveryStats
  ): Promise<void> {
    const { jobId } = persisted;
    try {
      const ageMs = Date.now() - persisted.startTime;
      if (ageMs > TRACKED_JOB_MAX_LIFETIME_MS) {
        stats.entriesExpired++;
        await this.discard(persisted, 'older than the tracker slot lifetime', stats);
        return;
      }

      const channel = await this.fetchChannel(persisted.channelId);
      if (channel === null) {
        await this.discard(persisted, 'channel unavailable', stats);
        return;
      }

      const personality = await this.lookupPersonalityWithFallback(persisted);
      if (personality === null) {
        await this.discard(persisted, 'personality no longer accessible', stats);
        return;
      }

      const context = await this.rebuildContext(persisted, channel, personality);
      if (context === null) {
        await this.discard(persisted, 'source message unavailable', stats);
        return;
      }

      // Re-adopt through the normal tracking path. This restores the typing
      // indicator as a side effect — `trackJob` arms the refresh loop — so a
      // user whose request survived a deploy sees the bot working again
      // instead of silence until the reply lands.
      this.deps.jobTracker.trackJob(jobId, context, { startTime: persisted.startTime });

      stats.entriesResumed++;
      logger.info(
        { jobId, channelId: persisted.channelId, kind: persisted.kind, ageMs },
        'Single-job context rehydrated'
      );
    } catch (err) {
      logger.error(
        { err, jobId },
        'Recovery failed for single-job context — leaving Redis state alone, will retry next startup'
      );
    }
  }

  /**
   * Rebuild the live `PendingJobContext` from identifiers. Returns null only
   * when the message-shaped variant's source Message can no longer be
   * fetched; the slash variant has no Message anchor and cannot fail here.
   */
  private async rebuildContext(
    persisted: PersistedJobContext,
    channel: TypingChannel,
    personality: LoadedPersonality
  ): Promise<PendingJobContext | null> {
    const base = {
      channel,
      guildId: persisted.guildId,
      clientId: persisted.clientId,
      userMessageTime: new Date(persisted.userMessageTime),
      personality,
      personaId: persisted.personaId,
    };

    if (persisted.kind === 'slash') {
      return {
        ...base,
        kind: 'slash',
        characterSlug: persisted.characterSlug,
        isWeighInMode: persisted.isWeighInMode,
        userId: persisted.userId,
      };
    }

    const message = await this.fetchSourceMessage(channel, persisted.sourceMessageId);
    if (message === null) {
      return null;
    }
    return {
      ...base,
      kind: 'message',
      message,
      userMessageContent: persisted.userMessageContent,
      isAutoResponse: persisted.isAutoResponse,
    };
  }

  /**
   * Drop an unrecoverable entry.
   *
   * Deliberately does NOT call `confirmDelivery`: nothing was delivered, so
   * confirming would record a success the user never received. The gateway
   * row stays `PENDING_DELIVERY`, which is the honest state and leaves the
   * loss visible. Contrast `discardRecoveredEntry`, which confirms only the
   * jobIds a prior run genuinely sent to Discord.
   */
  private async discard(
    persisted: PersistedJobContext,
    reason: string,
    stats: SingleJobRecoveryStats
  ): Promise<void> {
    await this.deps.persistence.delete(persisted.jobId);
    stats.entriesDiscarded++;
    logger.warn(
      { jobId: persisted.jobId, channelId: persisted.channelId, reason },
      'Single-job context discarded during recovery — the reply for this job cannot be delivered'
    );
  }

  private async fetchChannel(channelId: string): Promise<TypingChannel | null> {
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
        'Recovery: single-job source message fetch failed'
      );
      return null;
    }
  }

  /**
   * Load the personality by id first, then by slug. Ids are stable; a slug
   * can be renamed between the persist and this read, and without the
   * fallback such a job would be discarded as inaccessible. Mirrors
   * `MultiTagRecovery.lookupPersonalityWithFallback`.
   */
  private async lookupPersonalityWithFallback(
    persisted: PersistedJobContext
  ): Promise<LoadedPersonality | null> {
    const byId = await this.loadPersonalityOrNull(persisted.personalityId, persisted.userId);
    if (byId !== null) {
      return byId;
    }
    return this.loadPersonalityOrNull(persisted.personalitySlug, persisted.userId);
  }

  /**
   * Treat any throw as "no longer accessible" rather than letting it abort
   * recovery. `IPersonalityLoader.loadPersonality` accepts either a slug or
   * an id and disambiguates internally.
   */
  private async loadPersonalityOrNull(
    nameOrId: string,
    userId: string
  ): Promise<LoadedPersonality | null> {
    try {
      return await this.deps.personalityService.loadPersonality(nameOrId, userId);
    } catch (err) {
      logger.warn(
        { err, nameOrId, userId },
        'Recovery: single-job personality load threw — treating as inaccessible'
      );
      return null;
    }
  }
}
