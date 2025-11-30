/**
 * Health Check Routes
 *
 * Public endpoints for health monitoring (used by Railway).
 */

import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, HealthStatus } from '@tzurot/common-types';
import { checkQueueHealth } from '../../queue.js';
import { checkAvatarStorage } from '../../bootstrap/startup.js';
import type { HealthResponse } from '../../types.js';

const logger = createLogger('api-gateway');

/**
 * Create health check router
 * @param startTime - Server start time for uptime calculation
 */
export function createHealthRouter(startTime: number): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    void (async () => {
      try {
        const queueHealthy = await checkQueueHealth();
        const avatarStorage = await checkAvatarStorage();

        const health: HealthResponse = {
          status: queueHealthy ? HealthStatus.Healthy : HealthStatus.Degraded,
          services: {
            redis: queueHealthy,
            queue: queueHealthy,
            avatarStorage: avatarStorage.status === HealthStatus.Ok,
          },
          avatars: avatarStorage,
          timestamp: new Date().toISOString(),
          uptime: Date.now() - startTime,
        };

        const statusCode = queueHealthy ? StatusCodes.OK : StatusCodes.SERVICE_UNAVAILABLE;
        res.status(statusCode).json(health);
      } catch (error) {
        logger.error({ err: error }, '[Health] Health check failed');

        const health: HealthResponse = {
          status: HealthStatus.Unhealthy,
          services: {
            redis: false,
            queue: false,
          },
          timestamp: new Date().toISOString(),
          uptime: Date.now() - startTime,
        };

        res.status(StatusCodes.SERVICE_UNAVAILABLE).json(health);
      }
    })();
  });

  return router;
}
