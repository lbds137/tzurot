/**
 * POST /admin/invalidate-cache
 * Manually trigger cache invalidation for personality configurations
 */

import { Router, type Request, type RequestHandler, type Response } from 'express';
import { InvalidateCacheSchema } from '@tzurot/common-types/schemas/api/admin';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { requireOwnerAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('admin-invalidate-cache');

export const handleInvalidateCache = (deps: RouteDeps): RequestHandler => {
  const { cacheInvalidationService } = deps;
  if (cacheInvalidationService === undefined) {
    return (_req, res) => {
      sendError(
        res,
        ErrorResponses.serviceUnavailable('Cache invalidation service not configured')
      );
    };
  }
  return asyncHandler(async (req: Request, res: Response) => {
    const parseResult = InvalidateCacheSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const { personalityId, all } = parseResult.data;

    if (all) {
      // Invalidate all personality caches
      await cacheInvalidationService.invalidateAll();
      logger.info('Invalidated all personality caches');

      sendCustomSuccess(res, {
        success: true,
        invalidated: 'all',
        message: 'All personality caches invalidated across all services',
        timestamp: new Date().toISOString(),
      });
    } else if (personalityId !== undefined) {
      await cacheInvalidationService.invalidatePersonality(personalityId);
      logger.info({ personalityId }, 'Invalidated cache for personality');

      sendCustomSuccess(res, {
        success: true,
        invalidated: personalityId,
        message: `Cache invalidated for personality ${personalityId} across all services`,
        timestamp: new Date().toISOString(),
      });
    }
  });
};

export function createInvalidateCacheRoute(deps: RouteDeps): Router {
  const router = Router();
  router.post('/', requireOwnerAuth(), handleInvalidateCache(deps));
  return router;
}
