/**
 * Job Failure Listener
 *
 * Subscribes to BullMQ QueueEvents for the AI requests queue and unblocks
 * channel-ordering bookkeeping when a job fails or is removed without
 * producing a result.
 *
 * Two routing paths depending on which subsystem owns the failed jobId:
 *
 *   1. **Multi-tag slot job**: route through `MultiTagCoordinator.handleJobResult`
 *      with a synthesized failure `LLMGenerationResult`. Without this, the
 *      slot stays in `'pending'` status until the coordinator's safety
 *      timeout fires after 10 min, at which point the user sees a generic
 *      bot error. Live-failure routing matches the rehydration-time
 *      synthesis path: same shape, same flush behavior.
 *
 *   2. **Single-tag (legacy) job**: unblock the channel-ordering queue via
 *      `orderingService.cancelJob`. This was the listener's original purpose
 *      — multi-tag jobs register the groupId in the ordering service rather
 *      than individual slot.jobIds, so cancelJob is a safe no-op for them
 *      (kept as the fall-through path for non-multi-tag failures).
 */

import { QueueEvents } from 'bullmq';
import { getConfig } from '@tzurot/common-types/config/config';
import { type LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { parseRedisUrl, createBullMQRedisConfig } from '@tzurot/common-types/utils/redis';
import type { JobTracker } from './JobTracker.js';
import type { MultiTagCoordinator } from './MultiTagCoordinator.js';
import type { ResponseOrderingService } from './ResponseOrderingService.js';

const logger = createLogger('JobFailureListener');

export class JobFailureListener {
  private queueEvents?: QueueEvents;

  constructor(
    private readonly jobTracker: JobTracker,
    private readonly orderingService: ResponseOrderingService,
    private readonly multiTagCoordinator: MultiTagCoordinator
  ) {}

  start(): void {
    if (this.queueEvents !== undefined) {
      logger.warn('start() called while already running — ignoring');
      return;
    }
    const config = getConfig();
    if (config.REDIS_URL === undefined || config.REDIS_URL.length === 0) {
      throw new Error('REDIS_URL environment variable is required');
    }
    // createBullMQRedisConfig accepts the RedisConnectionConfig shape directly
    // and defaults family to 6 for Railway private-network IPv6 — no need to
    // destructure-and-rebuild as some other call sites still do.
    const redisConfig = createBullMQRedisConfig(parseRedisUrl(config.REDIS_URL));

    this.queueEvents = new QueueEvents(config.QUEUE_NAME, { connection: redisConfig });

    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      void this.handleTerminalEvent('failed', jobId, failedReason);
    });

    this.queueEvents.on('removed', ({ jobId }) => {
      void this.handleTerminalEvent('removed', jobId);
    });

    this.queueEvents.on('error', error => {
      logger.error({ err: error }, 'QueueEvents error');
    });

    logger.info({ queueName: config.QUEUE_NAME }, 'Started listening for job failures');
  }

  async stop(): Promise<void> {
    if (this.queueEvents) {
      await this.queueEvents.close();
      this.queueEvents = undefined;
      logger.info('Stopped job failure listener');
    }
  }

  /**
   * Public for direct invocation from tests so the suite doesn't have to drive
   * a real BullMQ QueueEvents instance. The event listeners above are thin
   * adapters that call this method.
   *
   * Intentionally does NOT call jobTracker.completeJob: the typing indicator
   * and "taking longer" notification cleanup lives there, and silently deleting
   * the "taking longer" message on failure would leave the user with no
   * indication that anything went wrong. The typing indicator times out at
   * TYPING_INDICATOR_TIMEOUT_MS and the orphan sweep releases the tracker
   * slot — that's the existing behavior for failures; this fix doesn't make
   * it worse. Surfacing failures to the user is a separate concern.
   */
  async handleTerminalEvent(
    reason: 'failed' | 'removed',
    jobId: string,
    failedReason?: string
  ): Promise<void> {
    // Top-level try/catch matches the success-path listener's discipline in
    // index.ts. Without it, `void this.handleTerminalEvent(...)` in the event
    // wiring discards the promise and any thrown error surfaces as
    // unhandledRejection — which terminates the Node process in Node 15+.
    try {
      // Multi-tag path: synthesize a failure result and route through the
      // coordinator's normal delivery flow. This drives the slot to terminal
      // immediately instead of waiting for the 10-min safety timeout.
      if (this.multiTagCoordinator.ownsJob(jobId)) {
        const syntheticFailure: LLMGenerationResult = {
          requestId: jobId,
          success: false,
          error: failedReason ?? `Job ${reason} (no reason provided)`,
        };
        logger.info(
          { jobId, reason, failedReason },
          'Multi-tag slot terminal event — routing to coordinator'
        );
        await this.multiTagCoordinator.handleJobResult(jobId, syntheticFailure);
        return;
      }

      // Single-tag path: unblock the channel-ordering queue. (Multi-tag jobs
      // register groupId on the ordering service rather than individual
      // slot.jobIds, so reaching this branch for a multi-tag jobId is
      // already a safe no-op — but the ownsJob check above keeps the
      // semantics explicit.)
      const context = this.jobTracker.getContext(jobId);
      if (context === null) {
        logger.debug({ jobId, reason }, 'Terminal event for unknown job — no action');
        return;
      }
      const channelId = context.channel.id;
      logger.info(
        { jobId, channelId, reason, failedReason },
        'AI job terminal event — unblocking channel ordering queue'
      );
      await this.orderingService.cancelJob(channelId, jobId);
    } catch (err) {
      logger.error({ err, jobId, reason, failedReason }, 'Failed to handle AI job terminal event');
    }
  }
}
