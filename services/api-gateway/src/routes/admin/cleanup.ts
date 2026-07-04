/**
 * POST /admin/cleanup
 * Manually trigger cleanup of old conversation history and tombstones
 */

import { Router, type Request, type RequestHandler, type Response } from 'express';
import { CLEANUP_DEFAULTS } from '@tzurot/common-types/constants/timing';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { requireOwnerAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('admin-cleanup');

interface CleanupResult {
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

/**
 * POST /api/admin/cleanup — named handler export. Returns 503 if the
 * retention service wasn't wired. The legacy aggregator gates
 * conditionally so this branch is only reachable when the route is
 * mounted unconditionally.
 */
export const handleCleanup = (deps: RouteDeps): RequestHandler => {
  const { retentionService } = deps;
  if (retentionService === undefined) {
    return (_req, res) => {
      sendError(res, ErrorResponses.serviceUnavailable('Retention service not configured'));
    };
  }
  return asyncHandler(async (req: Request, res: Response) => {
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
      // Parity with the scheduled daily job: "history cleanup" also hard-deletes
      // soft-deleted rows past their grace period (its OWN default window, not
      // daysToKeep — the soft-delete grace is a separate retention policy). Both
      // delete conversation_history rows, so the counts fold together.
      historyDeleted += await retentionService.cleanupSoftDeletedMessages();
      logger.info({ historyDeleted, daysToKeep }, 'Cleaned up old conversation history');
    }

    if (target === 'tombstones' || target === 'all') {
      tombstonesDeleted = await retentionService.cleanupOldTombstones(daysToKeep);
      logger.info({ tombstonesDeleted, daysToKeep }, 'Cleaned up old tombstones');
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
  });
};

/**
 * Legacy factory for the `/admin/cleanup` mount. Wraps the named
 * handler with per-route middleware for callers that haven't yet
 * migrated to the bare handler export.
 */
export function createCleanupRoute(deps: RouteDeps): Router {
  const router = Router();
  router.post('/', requireOwnerAuth(), handleCleanup(deps));
  return router;
}
