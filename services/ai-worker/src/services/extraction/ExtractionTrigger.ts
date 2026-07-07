/**
 * Fact-Extraction Trigger — turn-count batching (§3.2)
 *
 * Called as a fire-and-forget tail step after each successful verbatim episode
 * write. Accumulates episode ids per (channel, personality) in a Redis list
 * (its length IS the turn counter — one key, one atomic op) and enqueues an
 * extraction job when the batch threshold is reached.
 *
 * **Idempotent by construction**: the BullMQ jobId is deterministic from the
 * batch window's FIRST episode id. A crash between enqueue and list-clear
 * re-reads the same list head on the next episode → same jobId → BullMQ
 * dedups the add → the clear proceeds. The worker reads sourceMemoryIds from
 * the JOB PAYLOAD, never from Redis, so a cleared list can't strand a job.
 *
 * **Loss posture**: a Redis restart loses at most one partial batch of ids —
 * extraction is delayed (the next N episodes rebuild the batch), never lost
 * data (episodes are safe in Postgres). A channel going quiet mid-batch
 * leaves a partial list until its TTL; those episodes are simply never
 * extracted (bounded, acceptable for shadow mode — a periodic flusher is a
 * tracked follow-up if observation shows it matters).
 */

import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import { CACHE_KEY_PREFIXES } from '@tzurot/common-types/constants/redis-keys';
import { JobType } from '@tzurot/common-types/constants/queue';
import { generateFactExtractionJobUuid } from '@tzurot/common-types/utils/deterministicUuid';
import type { FactExtractionJobData } from '@tzurot/common-types/types/jobs';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('ExtractionTrigger');

const KEY_PREFIX = CACHE_KEY_PREFIXES.FACT_EXTRACTION_COUNTER;

/**
 * Pending-list TTL. Bounds Redis growth for channels that go quiet mid-batch;
 * generous so slow-but-alive conversations still accumulate to threshold.
 */
const PENDING_LIST_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Atomic RPUSH + first-push EXPIRE; returns the new list length (the count). */
const RPUSH_WITH_EXPIRE_LUA = `
local len = redis.call('RPUSH', KEYS[1], ARGV[1])
if len == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return len
`;

export class ExtractionTrigger {
  constructor(
    private readonly redis: Redis,
    private readonly queue: Queue,
    private readonly batchThreshold: number
  ) {}

  /**
   * Record one stored episode; enqueue an extraction batch at threshold.
   *
   * Never throws — this rides the memory-write tail and must not fail the
   * reply pipeline. All errors degrade to "extraction delayed."
   */
  async recordEpisode(channelId: string, personalityId: string, memoryId: string): Promise<void> {
    const key = `${KEY_PREFIX}${channelId}:${personalityId}`;
    try {
      const count = (await this.redis.eval(
        RPUSH_WITH_EXPIRE_LUA,
        1,
        key,
        memoryId,
        String(PENDING_LIST_TTL_SECONDS)
      )) as number;

      if (count < this.batchThreshold) {
        return;
      }

      const pendingIds = await this.redis.lrange(key, 0, -1);
      if (pendingIds.length === 0) {
        return; // another process already flushed the batch
      }
      const windowStart = pendingIds[0];
      const jobId = generateFactExtractionJobUuid(channelId, personalityId, windowStart);

      const jobData: FactExtractionJobData = {
        requestId: `fact-extract-${jobId}`,
        jobType: JobType.FactExtraction,
        responseDestination: { type: 'api' },
        version: 1,
        channelId,
        personalityId,
        sourceMemoryIds: pendingIds,
        windowStart,
      };

      await this.queue.add(JobType.FactExtraction, jobData, {
        jobId, // deterministic — a crash-retry re-add is a no-op
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 50, age: 24 * 3600 },
        removeOnFail: { count: 100, age: 7 * 24 * 3600 },
      });

      await this.redis.del(key);
      logger.info(
        { channelId, personalityId, batchSize: pendingIds.length, jobId },
        'Enqueued fact-extraction batch'
      );
    } catch (error) {
      logger.warn(
        { err: error, channelId, personalityId },
        'Extraction trigger failed — extraction delayed, episode is safe in Postgres'
      );
    }
  }
}
