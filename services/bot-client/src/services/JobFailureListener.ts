/**
 * Job Failure Listener
 *
 * Subscribes to BullMQ QueueEvents for the AI requests queue and unblocks
 * channel-ordering bookkeeping when a job fails or is removed without
 * producing a result.
 *
 * Without this listener, a failed AI job leaves a "pending job" entry in
 * ResponseOrderingService that blocks any later response in the same channel
 * until MAX_WAIT_MS (10 min) elapses via the timeout-escape path. With it,
 * failures unblock the queue immediately by calling orderingService.cancelJob
 * via the JobTracker-managed jobId → channelId lookup.
 */

import { QueueEvents } from 'bullmq';
import {
  createLogger,
  getConfig,
  parseRedisUrl,
  createBullMQRedisConfig,
} from '@tzurot/common-types';
import type { JobTracker } from './JobTracker.js';
import type { ResponseOrderingService } from './ResponseOrderingService.js';

const logger = createLogger('JobFailureListener');

export class JobFailureListener {
  private queueEvents?: QueueEvents;

  constructor(
    private readonly jobTracker: JobTracker,
    private readonly orderingService: ResponseOrderingService
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
      // cancelJob is idempotent: it no-ops if jobId isn't in the channel's
      // pending set. Multi-tag's normal path registers groupId rather than the
      // individual slot.jobId, so a slot failure here is a safe no-op.
      await this.orderingService.cancelJob(channelId, jobId);
    } catch (err) {
      logger.error(
        { err, jobId, reason, failedReason },
        'Failed to unblock channel ordering queue on AI job terminal event'
      );
    }
  }
}
