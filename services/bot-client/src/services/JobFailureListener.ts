/**
 * Job Failure Listener
 *
 * Subscribes to BullMQ QueueEvents for the AI requests queue and handles
 * terminal (failed/removed) job outcomes that will never produce a result
 * on the normal results path.
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
 *   2. **Single-tag (legacy) job**: route the synthesized failure through
 *      `orderingService.handleResult`, the same channel-ordering entry point
 *      the soft-result listener (`index.ts`) uses, so a hard failure is
 *      delivered in the same userMessageTime order as every other result in
 *      the channel instead of jumping ahead of buffered siblings. The
 *      deliverFn it's given routes to `MessageHandler.handleJobResult`, which
 *      looks up the job's stored kind/context itself and dispatches to the
 *      same per-kind error rendering (`reportJobError` plus the slash/message
 *      error responder) that a soft `success: false` result would trigger —
 *      so a hard BullMQ failure on a slash `/chat`/`/random`/`/chime-in` job
 *      or a DM session message is no longer silent to the user.
 */

import { QueueEvents } from 'bullmq';
import { getConfig } from '@tzurot/common-types/config/config';
import { type LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { parseRedisUrl, createBullMQRedisConfig } from '@tzurot/common-types/utils/redis';
import type { MessageHandler } from '../handlers/MessageHandler.js';
import type { JobTracker } from './JobTracker.js';
import type { MultiTagCoordinator } from './MultiTagCoordinator.js';
import type { ResponseOrderingService } from './ResponseOrderingService.js';

const logger = createLogger('JobFailureListener');

/** Synthesizes the same failure `LLMGenerationResult` shape both routing paths deliver. */
function buildSyntheticFailure(
  reason: 'failed' | 'removed',
  jobId: string,
  failedReason?: string
): LLMGenerationResult {
  return {
    requestId: jobId,
    success: false,
    error: failedReason ?? `Job ${reason} (no reason provided)`,
  };
}

export class JobFailureListener {
  private queueEvents?: QueueEvents;

  constructor(
    private readonly jobTracker: JobTracker,
    private readonly orderingService: ResponseOrderingService,
    private readonly multiTagCoordinator: MultiTagCoordinator,
    private readonly messageHandler: MessageHandler
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
   * This method itself never calls `jobTracker.completeJob` — for the
   * single-tag path below, tracker completion and user-facing delivery both
   * belong to `MessageHandler.handleJobResult`, which that path hands off
   * to. For the multi-tag path, `MultiTagCoordinator.handleJobResult` owns
   * both instead. Either way, this listener stays a thin router and failure
   * handling lands on the same completion/delivery path a soft
   * `success: false` result already takes.
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
        const syntheticFailure = buildSyntheticFailure(reason, jobId, failedReason);
        logger.info(
          { jobId, reason, failedReason },
          'Multi-tag slot terminal event — routing to coordinator'
        );
        await this.multiTagCoordinator.handleJobResult(jobId, syntheticFailure);
        return;
      }

      // Single-tag path: deliver a synthesized failure through
      // orderingService.handleResult, the same channel-ordering entry point
      // the soft-result listener uses (index.ts's startResultsListener), so
      // the failure notice takes its place in userMessageTime order instead
      // of bypassing the queue and landing ahead of buffered siblings.
      // (Multi-tag jobs register groupId on the ordering service rather than
      // individual slot.jobIds, so reaching this branch for a multi-tag
      // jobId can't happen in practice — but the ownsJob check above keeps
      // the routing explicit rather than relying on that absence.)
      const context = this.jobTracker.getContext(jobId);
      if (context === null) {
        logger.debug({ jobId, reason }, 'Terminal event for unknown job — no action');
        return;
      }
      const channelId = context.channel.id;
      logger.info(
        { jobId, channelId, reason, failedReason },
        'AI job terminal event — routing synthesized failure through ordering service'
      );

      // Route the same synthesized failure shape through the results-path
      // entry point so the job kind's own error rendering fires. No
      // `jobResult` row exists to confirm delivery against here — only
      // `AIJobProcessor.persistAndPublishResult` (which never ran for a
      // hard-failed job) creates one — so there is nothing to confirm.
      const syntheticFailure = buildSyntheticFailure(reason, jobId, failedReason);
      await this.orderingService.handleResult(
        channelId,
        jobId,
        syntheticFailure,
        context.userMessageTime,
        // The returned disposition is deliberately discarded: as the comment
        // above records, a hard-failed job never produced a `jobResult` row,
        // so there is nothing here to confirm either way.
        async (jId, res) => {
          await this.messageHandler.handleJobResult(jId, res);
        }
      );
    } catch (err) {
      logger.error({ err, jobId, reason, failedReason }, 'Failed to handle AI job terminal event');
    }
  }
}
