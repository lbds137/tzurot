/**
 * POST /admin/invalidate-cache
 * Manually trigger cache invalidation for personality configurations
 */

import { Router, type Request, type Response } from 'express';
import { createLogger, type CacheInvalidationService } from '@tzurot/common-types';
import { requireOwnerAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';

const logger = createLogger('admin-invalidate-cache');

export function createInvalidateCacheRoute(
  cacheInvalidationService: CacheInvalidationService
): Router {
  const router = Router();

  router.post(
    '/',
    requireOwnerAuth(),
    asyncHandler(async (req: Request, res: Response) => {
      const { personalityId, all = false } = req.body as {
        personalityId?: string;
        all?: boolean;
      };

      if (all) {
        // Invalidate all personality caches
        await cacheInvalidationService.invalidateAll();
        logger.info('[Admin] Invalidated all personality caches');

        sendCustomSuccess(res, {
          success: true,
          invalidated: 'all',
          message: 'All personality caches invalidated across all services',
          timestamp: new Date().toISOString(),
        });
      } else if (personalityId !== undefined && personalityId.length > 0) {
        // Invalidate specific personality cache
        await cacheInvalidationService.invalidatePersonality(personalityId);
        logger.info(`[Admin] Invalidated cache for personality: ${personalityId}`);

        sendCustomSuccess(res, {
          success: true,
          invalidated: personalityId,
          message: `Cache invalidated for personality ${personalityId} across all services`,
          timestamp: new Date().toISOString(),
        });
      } else {
        return sendError(
          res,
          ErrorResponses.validationError('Must provide either "personalityId" or "all: true"')
        );
      }
    })
  );

  return router;
}
