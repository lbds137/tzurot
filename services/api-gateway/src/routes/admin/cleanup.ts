/**
 * POST /admin/cleanup
 * Manually trigger cleanup of old conversation history and tombstones
 */

import { Router, type Request, type Response } from 'express';
import { createLogger, type ConversationHistoryService } from '@tzurot/common-types';
import { requireOwnerAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';

const logger = createLogger('admin-cleanup');

export interface CleanupResult {
  historyDeleted: number;
  tombstonesDeleted: number;
  daysKept: number;
}

export function createCleanupRoute(
  conversationHistoryService: ConversationHistoryService
): Router {
  const router = Router();

  router.post(
    '/',
    requireOwnerAuth(),
    asyncHandler(async (req: Request, res: Response) => {
      // Handle missing body gracefully
      const body = (req.body ?? {}) as {
        daysToKeep?: number;
        target?: 'history' | 'tombstones' | 'all';
      };
      const { daysToKeep = 30, target = 'all' } = body;

      // Validate daysToKeep
      if (typeof daysToKeep !== 'number' || daysToKeep < 1 || daysToKeep > 365) {
        return sendError(
          res,
          ErrorResponses.validationError('daysToKeep must be a number between 1 and 365')
        );
      }

      // Validate target
      if (!['history', 'tombstones', 'all'].includes(target)) {
        return sendError(
          res,
          ErrorResponses.validationError('target must be "history", "tombstones", or "all"')
        );
      }

      let historyDeleted = 0;
      let tombstonesDeleted = 0;

      if (target === 'history' || target === 'all') {
        historyDeleted = await conversationHistoryService.cleanupOldHistory(daysToKeep);
        logger.info(
          { historyDeleted, daysToKeep },
          '[Admin] Cleaned up old conversation history'
        );
      }

      if (target === 'tombstones' || target === 'all') {
        tombstonesDeleted = await conversationHistoryService.cleanupOldTombstones(daysToKeep);
        logger.info(
          { tombstonesDeleted, daysToKeep },
          '[Admin] Cleaned up old tombstones'
        );
      }

      const result: CleanupResult = {
        historyDeleted,
        tombstonesDeleted,
        daysKept: daysToKeep,
      };

      sendCustomSuccess(res, {
        success: true,
        ...result,
        message: `Cleanup complete: ${historyDeleted} history messages and ${tombstonesDeleted} tombstones deleted (older than ${daysToKeep} days)`,
        timestamp: new Date().toISOString(),
      });
    })
  );

  return router;
}
