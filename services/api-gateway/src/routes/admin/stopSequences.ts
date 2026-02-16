/**
 * Admin Stop Sequence Stats Routes
 * GET /admin/stop-sequences - Read stop sequence activation stats from Redis
 *
 * The ai-worker persists stats to Redis; this endpoint reads them
 * so bot-client can display them without direct ai-worker access.
 */

import { Router, type Response, type Request } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger } from '@tzurot/common-types';
import type { Redis } from 'ioredis';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess } from '../../utils/responseHelpers.js';

const logger = createLogger('admin-stop-sequences');

/** Redis keys matching ai-worker's StopSequenceTracker */
const REDIS_KEYS = {
  TOTAL: 'stop_seq:total',
  BY_SEQUENCE: 'stop_seq:by_sequence',
  BY_MODEL: 'stop_seq:by_model',
  STARTED_AT: 'stop_seq:started_at',
} as const;

export function createStopSequenceRoutes(redis: Redis): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req: Request, res: Response) => {
      const [totalStr, bySequence, byModel, startedAt] = await Promise.all([
        redis.get(REDIS_KEYS.TOTAL),
        redis.hgetall(REDIS_KEYS.BY_SEQUENCE),
        redis.hgetall(REDIS_KEYS.BY_MODEL),
        redis.get(REDIS_KEYS.STARTED_AT),
      ]);

      const total = totalStr !== null ? parseInt(totalStr, 10) : 0;

      // Convert hash string values to numbers
      const bySequenceNums: Record<string, number> = {};
      for (const [key, val] of Object.entries(bySequence)) {
        bySequenceNums[key] = parseInt(val, 10);
      }

      const byModelNums: Record<string, number> = {};
      for (const [key, val] of Object.entries(byModel)) {
        byModelNums[key] = parseInt(val, 10);
      }

      logger.info({ total }, '[StopSequences] Returned stats');

      sendCustomSuccess(
        res,
        {
          totalActivations: total,
          bySequence: bySequenceNums,
          byModel: byModelNums,
          startedAt: startedAt ?? new Date().toISOString(),
        },
        StatusCodes.OK
      );
    })
  );

  return router;
}
