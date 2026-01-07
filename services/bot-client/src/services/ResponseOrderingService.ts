/**
 * Response Ordering Service
 *
 * Ensures responses in a channel are delivered in the order users sent their
 * messages, not in the order jobs complete. This prevents fast free-tier models
 * from jumping ahead of slower paid models in the same channel.
 *
 * Algorithm:
 * 1. When a job is registered, we record its userMessageTime (chronological order)
 * 2. When a result arrives, we buffer it if older jobs are still pending
 * 3. We deliver results in userMessageTime order, waiting for predecessors
 * 4. Safety timeout (10 min) prevents indefinite blocking if a job is lost
 */

import { createLogger, TIMEOUTS, type LLMGenerationResult } from '@tzurot/common-types';

const logger = createLogger('ResponseOrderingService');

/**
 * A result that has been received but is waiting for delivery
 */
interface BufferedResult {
  jobId: string;
  result: LLMGenerationResult;
  userMessageTime: Date;
  receivedAt: number; // Date.now() for timeout calculation
}

/**
 * Pending job tracking with registration timestamp for stale cleanup
 */
interface PendingJob {
  userMessageTime: Date;
  /** When the job was registered (for stale job detection) */
  registeredAt: number;
}

/**
 * Per-channel queue state
 */
interface ChannelQueue {
  /** Jobs we're waiting on (registered but not yet completed) */
  pendingJobs: Map<string, PendingJob>;
  /** Results waiting for older jobs to complete first */
  bufferedResults: BufferedResult[];
}

/** Delivery callback type */
type DeliverFn = (jobId: string, result: LLMGenerationResult) => Promise<void>;

export class ResponseOrderingService {
  /** Channel-scoped queues (different channels are independent) */
  private channelQueues = new Map<string, ChannelQueue>();

  /** Safety timeout - matches TIMEOUTS.JOB_WAIT (10 min = 600000ms) */
  private readonly MAX_WAIT_MS = TIMEOUTS.JOB_WAIT;

  /**
   * Register a new job that will produce a result we need to order.
   * Must be called BEFORE the job starts processing.
   *
   * @param channelId - Discord channel ID
   * @param jobId - BullMQ job ID
   * @param userMessageTime - When the user sent their message
   */
  registerJob(channelId: string, jobId: string, userMessageTime: Date): void {
    let queue = this.channelQueues.get(channelId);
    if (!queue) {
      queue = { pendingJobs: new Map(), bufferedResults: [] };
      this.channelQueues.set(channelId, queue);
    }

    queue.pendingJobs.set(jobId, { userMessageTime, registeredAt: Date.now() });

    logger.debug(
      {
        channelId,
        jobId,
        userMessageTime: userMessageTime.toISOString(),
        pendingCount: queue.pendingJobs.size,
      },
      '[ResponseOrderingService] Registered job for ordering'
    );
  }

  /**
   * Handle a completed result. May deliver immediately or buffer until predecessors complete.
   *
   * @param channelId - Discord channel ID
   * @param jobId - BullMQ job ID
   * @param result - The LLM generation result
   * @param userMessageTime - When the user sent their message
   * @param deliverFn - Callback to actually deliver the result
   */
  async handleResult(
    channelId: string,
    jobId: string,
    result: LLMGenerationResult,
    userMessageTime: Date,
    deliverFn: DeliverFn
  ): Promise<void> {
    const queue = this.channelQueues.get(channelId);

    // Validate that job was registered - if not, deliver immediately
    // This catches programming errors where registerJob wasn't called
    if (!queue || !queue.pendingJobs.has(jobId)) {
      logger.warn(
        { channelId, jobId, hasQueue: queue !== undefined },
        '[ResponseOrderingService] Result for unregistered job - delivering immediately'
      );
      await deliverFn(jobId, result);
      return;
    }

    // Add to buffer
    queue.bufferedResults.push({
      jobId,
      result,
      userMessageTime,
      receivedAt: Date.now(),
    });

    logger.debug(
      { channelId, jobId, bufferedCount: queue.bufferedResults.length },
      '[ResponseOrderingService] Buffered result, processing queue'
    );

    // Process the queue to deliver any ready results
    await this.processQueue(channelId, deliverFn);
  }

  /**
   * Cancel a job (e.g., if it failed before producing a result).
   * This unblocks any results waiting for this job.
   *
   * @param channelId - Discord channel ID
   * @param jobId - BullMQ job ID
   * @param deliverFn - Callback to deliver any unblocked results
   */
  async cancelJob(channelId: string, jobId: string, deliverFn?: DeliverFn): Promise<void> {
    const queue = this.channelQueues.get(channelId);
    if (!queue) {
      return;
    }

    const wasRegistered = queue.pendingJobs.delete(jobId);

    if (wasRegistered) {
      logger.info({ channelId, jobId }, '[ResponseOrderingService] Cancelled pending job');

      // Re-process queue in case this unblocks buffered results
      if (deliverFn) {
        await this.processQueue(channelId, deliverFn);
      }
    }

    this.cleanupIfEmpty(channelId, queue);
  }

  /**
   * Process the queue, delivering results that are ready.
   * A result is ready when:
   * - No pending jobs have an earlier userMessageTime, OR
   * - The result has been waiting longer than MAX_WAIT_MS (timeout escape)
   */
  private async processQueue(channelId: string, deliverFn: DeliverFn): Promise<void> {
    const queue = this.channelQueues.get(channelId);
    if (!queue || queue.bufferedResults.length === 0) {
      return;
    }

    // Sort buffer by userMessageTime (oldest first)
    queue.bufferedResults.sort((a, b) => a.userMessageTime.getTime() - b.userMessageTime.getTime());

    // Deliver all results that are ready
    while (queue.bufferedResults.length > 0) {
      const oldest = queue.bufferedResults[0];
      const oldestTime = oldest.userMessageTime.getTime();
      const now = Date.now();

      // Find the oldest pending job (excluding the one we're considering)
      let oldestPendingTime: number | null = null;
      for (const [pendingJobId, pending] of queue.pendingJobs) {
        // Skip the job we're about to deliver (it's in pending until we deliver)
        if (pendingJobId === oldest.jobId) {
          continue;
        }

        const time = pending.userMessageTime.getTime();
        if (oldestPendingTime === null || time < oldestPendingTime) {
          oldestPendingTime = time;
        }
      }

      // Check timeout: if waiting too long, deliver anyway
      const waitTime = now - oldest.receivedAt;
      const isTimedOut = waitTime > this.MAX_WAIT_MS;

      // Can deliver if:
      // 1. No older pending jobs exist, OR
      // 2. This job is older than or equal to all pending jobs, OR
      // 3. Timed out waiting
      const canDeliver =
        oldestPendingTime === null || oldestTime <= oldestPendingTime || isTimedOut;

      if (!canDeliver) {
        // Blocked by an older pending job - stop processing
        logger.debug(
          {
            channelId,
            blockedJobId: oldest.jobId,
            blockedTime: oldest.userMessageTime.toISOString(),
            oldestPendingTime:
              oldestPendingTime !== null ? new Date(oldestPendingTime).toISOString() : null,
            waitTimeMs: waitTime,
          },
          '[ResponseOrderingService] Result blocked waiting for older job'
        );
        break;
      }

      // Remove from buffer
      queue.bufferedResults.shift();

      // Remove from pending (it's no longer pending, it's being delivered)
      queue.pendingJobs.delete(oldest.jobId);

      // Log delivery decision
      if (isTimedOut) {
        logger.warn(
          {
            channelId,
            jobId: oldest.jobId,
            waitTimeMs: waitTime,
            maxWaitMs: this.MAX_WAIT_MS,
          },
          '[ResponseOrderingService] Delivering result after timeout (predecessor never completed)'
        );
      } else {
        logger.info(
          {
            channelId,
            jobId: oldest.jobId,
            userMessageTime: oldest.userMessageTime.toISOString(),
            remainingBuffered: queue.bufferedResults.length,
            remainingPending: queue.pendingJobs.size,
          },
          '[ResponseOrderingService] Delivering result in order'
        );
      }

      // Deliver the result
      try {
        await deliverFn(oldest.jobId, oldest.result);
      } catch (error) {
        // Log but continue processing queue - don't let one failure block others
        logger.error(
          { err: error, channelId, jobId: oldest.jobId },
          '[ResponseOrderingService] Failed to deliver result'
        );
      }
    }

    this.cleanupIfEmpty(channelId, queue);
  }

  /**
   * Clean up a channel queue if it's empty
   */
  private cleanupIfEmpty(channelId: string, queue: ChannelQueue): void {
    if (queue.pendingJobs.size === 0 && queue.bufferedResults.length === 0) {
      this.channelQueues.delete(channelId);
      logger.debug({ channelId }, '[ResponseOrderingService] Cleaned up empty channel queue');
    }
  }

  /**
   * Clean up stale pending jobs that never produced results.
   *
   * This handles the edge case where a job is registered but:
   * - The worker crashes before producing a result
   * - BullMQ doesn't retry (exhausted retries, job removed, etc.)
   * - No explicit cancelJob call is made
   *
   * Without cleanup, these orphaned jobs would stay in pendingJobs forever,
   * causing a slow memory leak over long uptimes.
   *
   * Stale threshold: 1.5x MAX_WAIT_MS (15 minutes when MAX_WAIT is 10 min)
   * This gives plenty of time for normal processing + retries.
   */
  cleanupStaleJobs(): { cleanedCount: number; channelsCleaned: string[] } {
    const staleThreshold = Date.now() - this.MAX_WAIT_MS * 1.5;
    let cleanedCount = 0;
    const channelsCleaned: string[] = [];

    for (const [channelId, queue] of this.channelQueues) {
      const staleJobIds: string[] = [];

      for (const [jobId, job] of queue.pendingJobs) {
        if (job.registeredAt < staleThreshold) {
          staleJobIds.push(jobId);
        }
      }

      if (staleJobIds.length > 0) {
        for (const jobId of staleJobIds) {
          queue.pendingJobs.delete(jobId);
          cleanedCount++;
        }

        logger.warn(
          { channelId, staleJobIds, staleCount: staleJobIds.length },
          '[ResponseOrderingService] Cleaned up stale pending jobs (never completed)'
        );

        channelsCleaned.push(channelId);
        this.cleanupIfEmpty(channelId, queue);
      }
    }

    if (cleanedCount > 0) {
      logger.info(
        { cleanedCount, channelsCleaned },
        '[ResponseOrderingService] Stale job cleanup complete'
      );
    }

    return { cleanedCount, channelsCleaned };
  }

  /**
   * Shutdown: deliver all buffered results immediately (in order).
   * Called during graceful shutdown to avoid losing results.
   */
  async shutdown(deliverFn: DeliverFn): Promise<void> {
    logger.info(
      { channelCount: this.channelQueues.size },
      '[ResponseOrderingService] Shutting down - delivering all buffered results'
    );

    for (const [channelId, queue] of this.channelQueues) {
      // Sort by userMessageTime and deliver all
      queue.bufferedResults.sort(
        (a, b) => a.userMessageTime.getTime() - b.userMessageTime.getTime()
      );

      for (const buffered of queue.bufferedResults) {
        try {
          await deliverFn(buffered.jobId, buffered.result);
          logger.debug(
            { channelId, jobId: buffered.jobId },
            '[ResponseOrderingService] Delivered buffered result on shutdown'
          );
        } catch (error) {
          logger.error(
            { err: error, channelId, jobId: buffered.jobId },
            '[ResponseOrderingService] Failed to deliver buffered result on shutdown'
          );
        }
      }
    }

    this.channelQueues.clear();
    logger.info('[ResponseOrderingService] Shutdown complete');
  }

  /**
   * Get stats for monitoring
   */
  getStats(): { channelCount: number; totalPending: number; totalBuffered: number } {
    let totalPending = 0;
    let totalBuffered = 0;

    for (const queue of this.channelQueues.values()) {
      totalPending += queue.pendingJobs.size;
      totalBuffered += queue.bufferedResults.length;
    }

    return {
      channelCount: this.channelQueues.size,
      totalPending,
      totalBuffered,
    };
  }
}
