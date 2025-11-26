/**
 * User Usage Routes
 * GET /user/usage - Get token usage statistics
 */

import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, type PrismaClient } from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';

const logger = createLogger('user-usage');

/**
 * Period options for usage query
 */
type UsagePeriod = 'day' | 'week' | 'month' | 'all';

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

interface UsageStats {
  period: UsagePeriod;
  periodStart: string | null;
  periodEnd: string;
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalTokens: number;
  byProvider: Record<
    string,
    {
      requests: number;
      tokensIn: number;
      tokensOut: number;
    }
  >;
  byModel: Record<
    string,
    {
      requests: number;
      tokensIn: number;
      tokensOut: number;
    }
  >;
  byRequestType: Record<
    string,
    {
      requests: number;
      tokensIn: number;
      tokensOut: number;
    }
  >;
}

export function createUsageRoutes(prisma: PrismaClient): Router {
  const router = Router();

  /**
   * GET /user/usage
   * Get token usage statistics
   *
   * Query params:
   * - period: 'day' | 'week' | 'month' | 'all' (default: 'month')
   */
  router.get(
    '/',
    requireUserAuth(),
    asyncHandler(async (req: Request, res: Response) => {
      const discordUserId = (req as Request & { userId: string }).userId;
      const period = (req.query.period as UsagePeriod) ?? 'month';

      // Validate period
      if (!['day', 'week', 'month', 'all'].includes(period)) {
        return sendError(
          res,
          ErrorResponses.validationError("period must be 'day', 'week', 'month', or 'all'")
        );
      }

      // Get user ID
      const user = await prisma.user.findFirst({
        where: { discordId: discordUserId },
        select: { id: true },
      });

      if (user === null) {
        // No user = no usage
        const emptyStats: UsageStats = {
          period,
          periodStart: getPeriodStartDate(period)?.toISOString() ?? null,
          periodEnd: new Date().toISOString(),
          totalRequests: 0,
          totalTokensIn: 0,
          totalTokensOut: 0,
          totalTokens: 0,
          byProvider: {},
          byModel: {},
          byRequestType: {},
        };
        return sendCustomSuccess(res, emptyStats, StatusCodes.OK);
      }

      const periodStart = getPeriodStartDate(period);

      // Build where clause
      const where: { userId: string; createdAt?: { gte: Date } } = {
        userId: user.id,
      };
      if (periodStart !== null) {
        where.createdAt = { gte: periodStart };
      }

      // Get all usage logs for the period
      const usageLogs = await prisma.usageLog.findMany({
        where,
        select: {
          provider: true,
          model: true,
          tokensIn: true,
          tokensOut: true,
          requestType: true,
        },
      });

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

        // By model
        stats.byModel[log.model] ??= { requests: 0, tokensIn: 0, tokensOut: 0 };
        stats.byModel[log.model].requests++;
        stats.byModel[log.model].tokensIn += log.tokensIn;
        stats.byModel[log.model].tokensOut += log.tokensOut;

        // By request type
        stats.byRequestType[log.requestType] ??= { requests: 0, tokensIn: 0, tokensOut: 0 };
        stats.byRequestType[log.requestType].requests++;
        stats.byRequestType[log.requestType].tokensIn += log.tokensIn;
        stats.byRequestType[log.requestType].tokensOut += log.tokensOut;
      }

      logger.info(
        { discordUserId, period, totalRequests: stats.totalRequests },
        '[Usage] Returned usage stats'
      );

      sendCustomSuccess(res, stats, StatusCodes.OK);
    })
  );

  return router;
}
