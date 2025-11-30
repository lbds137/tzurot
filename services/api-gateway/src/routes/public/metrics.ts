/**
 * Metrics Routes
 *
 * Public endpoint for service metrics.
 */

import { Router } from 'express';
import type { Queue } from 'bullmq';
import { StatusCodes } from 'http-status-codes';
import { createLogger } from '@tzurot/common-types';
import { getDeduplicationCache } from '../../utils/deduplicationCache.js';
import { ErrorResponses } from '../../utils/errorResponses.js';

const logger = createLogger('api-gateway');

/**
 * Create metrics router
 * @param queue - BullMQ queue instance
 * @param startTime - Server start time for uptime calculation
 */
export function createMetricsRouter(queue: Queue, startTime: number): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    void (async () => {
      try {
        const deduplicationCache = getDeduplicationCache();
        const [waiting, active, completed, failed, cacheSize] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getCompletedCount(),
          queue.getFailedCount(),
          deduplicationCache.getCacheSize(),
        ]);

        res.json({
          queue: {
            waiting,
            active,
            completed,
            failed,
            total: waiting + active,
          },
          cache: {
            size: cacheSize,
          },
          uptime: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, '[Metrics] Failed to get metrics');

        const errorResponse = ErrorResponses.metricsError(
          error instanceof Error ? error.message : 'Unknown error'
        );

        res.status(StatusCodes.INTERNAL_SERVER_ERROR).json(errorResponse);
      }
    })();
  });

  return router;
}
