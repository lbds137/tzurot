/**
 * POST /admin/cleanup
 * Manually trigger cleanup of old conversation history and tombstones
 */

import { Router, type Request, type Response } from 'express';
import {
  createLogger,
  CLEANUP_DEFAULTS,
  type ConversationRetentionService,
} from '@tzurot/common-types';
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

/**
 * Build a human-readable cleanup message based on target
 */
function buildCleanupMessage(
  target: 'history' | 'tombstones' | 'all',
  historyDeleted: number,
  tombstonesDeleted: number,
  daysToKeep: number
): string {
  const suffix = `(older than ${daysToKeep} days)`;
  switch (target) {
    case 'history':
      return `Cleanup complete: ${historyDeleted} history messages deleted ${suffix}`;
    case 'tombstones':
      return `Cleanup complete: ${tombstonesDeleted} tombstones deleted ${suffix}`;
    case 'all':
      return `Cleanup complete: ${historyDeleted} history messages and ${tombstonesDeleted} tombstones deleted ${suffix}`;
  }
}

export function createCleanupRoute(retentionService: ConversationRetentionService): Router {
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
      const { daysToKeep = CLEANUP_DEFAULTS.DAYS_TO_KEEP_HISTORY, target = 'all' } = body;

      // Validate daysToKeep
      if (
        typeof daysToKeep !== 'number' ||
        daysToKeep < CLEANUP_DEFAULTS.MIN_DAYS ||
        daysToKeep > CLEANUP_DEFAULTS.MAX_DAYS
      ) {
        return sendError(
          res,
          ErrorResponses.validationError(
            `daysToKeep must be a number between ${CLEANUP_DEFAULTS.MIN_DAYS} and ${CLEANUP_DEFAULTS.MAX_DAYS}`
          )
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
        historyDeleted = await retentionService.cleanupOldHistory(daysToKeep);
        logger.info({ historyDeleted, daysToKeep }, '[Admin] Cleaned up old conversation history');
      }

      if (target === 'tombstones' || target === 'all') {
        tombstonesDeleted = await retentionService.cleanupOldTombstones(daysToKeep);
        logger.info({ tombstonesDeleted, daysToKeep }, '[Admin] Cleaned up old tombstones');
      }

      const result: CleanupResult = {
        historyDeleted,
        tombstonesDeleted,
        daysKept: daysToKeep,
      };

      sendCustomSuccess(res, {
        success: true,
        ...result,
        message: buildCleanupMessage(target, historyDeleted, tombstonesDeleted, daysToKeep),
        timestamp: new Date().toISOString(),
      });
    })
  );

  return router;
}
