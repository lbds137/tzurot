/**
 * User Usage Routes
 * GET /user/usage - Get token usage statistics
 */

import { Router, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { type UsagePeriod, type UsageStats } from '@tzurot/common-types/schemas/api/usage';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { shortModelName } from '@tzurot/common-types/utils/modelNames';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { ProvisionedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('user-usage');

/**
 * Get the start date for a period
 */
function getPeriodStartDate(period: UsagePeriod): Date | null {
  const now = new Date();

  switch (period) {
    case 'day':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case 'week': {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - 7);
      weekStart.setHours(0, 0, 0, 0);
      return weekStart;
    }
    case 'month': {
      const monthStart = new Date(now);
      monthStart.setDate(now.getDate() - 30);
      monthStart.setHours(0, 0, 0, 0);
      return monthStart;
    }
    case 'all':
      return null; // No date filter
    default:
      return null;
  }
}

/** GET /api/user/usage — token usage statistics for the current user */
export const handleGetUserUsage = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const period = (req.query.period as UsagePeriod) ?? 'month';

    // Validate period
    if (!['day', 'week', 'month', 'all'].includes(period)) {
      return sendError(
        res,
        ErrorResponses.validationError("period must be 'day', 'week', 'month', or 'all'")
      );
    }

    const userId = resolveProvisionedUserId(req);

    const periodStart = getPeriodStartDate(period);

    // Build where clause
    const where: { userId: string; createdAt?: { gte: Date } } = {
      userId,
    };
    if (periodStart !== null) {
      where.createdAt = { gte: periodStart };
    }

    // Get usage logs for the period (bounded to prevent OOM on large datasets)
    const MAX_USAGE_LOGS = 10000;
    const usageLogs = await prisma.usageLog.findMany({
      where,
      select: {
        provider: true,
        model: true,
        tokensIn: true,
        tokensOut: true,
        requestType: true,
      },
      take: MAX_USAGE_LOGS,
      orderBy: { createdAt: 'desc' },
    });
    const limitReached = usageLogs.length === MAX_USAGE_LOGS;

    // Aggregate stats
    const stats: UsageStats = {
      period,
      periodStart: periodStart?.toISOString() ?? null,
      periodEnd: new Date().toISOString(),
      totalRequests: usageLogs.length,
      totalTokensIn: 0,
      totalTokensOut: 0,
      totalTokens: 0,
      byProvider: {},
      byModel: {},
      byRequestType: {},
      limitReached,
    };

    for (const log of usageLogs) {
      // Totals
      stats.totalTokensIn += log.tokensIn;
      stats.totalTokensOut += log.tokensOut;
      stats.totalTokens += log.tokensIn + log.tokensOut;

      // By provider
      stats.byProvider[log.provider] ??= { requests: 0, tokensIn: 0, tokensOut: 0 };
      stats.byProvider[log.provider].requests++;
      stats.byProvider[log.provider].tokensIn += log.tokensIn;
      stats.byProvider[log.provider].tokensOut += log.tokensOut;

      // By model — keyed by the SHORT name so the same model reached via two
      // providers (z-ai/glm-5.2 vs openrouter's glm-5.2) aggregates into one
      // row; the per-provider split has its own section.
      const modelKey = shortModelName(log.model);
      stats.byModel[modelKey] ??= { requests: 0, tokensIn: 0, tokensOut: 0 };
      stats.byModel[modelKey].requests++;
      stats.byModel[modelKey].tokensIn += log.tokensIn;
      stats.byModel[modelKey].tokensOut += log.tokensOut;

      // By request type
      stats.byRequestType[log.requestType] ??= { requests: 0, tokensIn: 0, tokensOut: 0 };
      stats.byRequestType[log.requestType].requests++;
      stats.byRequestType[log.requestType].tokensIn += log.tokensIn;
      stats.byRequestType[log.requestType].tokensOut += log.tokensOut;
    }

    logger.info(
      { discordUserId, period, totalRequests: stats.totalRequests },
      'Returned usage stats'
    );

    sendCustomSuccess(res, stats, StatusCodes.OK);
  });
};

export function createUsageRoutes(deps: RouteDeps): Router {
  const router = Router();
  router.get('/', requireUserAuth(), requireProvisionedUser(deps.prisma), handleGetUserUsage(deps));
  return router;
}
