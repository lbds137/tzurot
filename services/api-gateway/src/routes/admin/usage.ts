/**
 * Admin Usage Routes
 * GET /admin/usage - Get global token usage statistics (all users)
 */

import { Router, type Response, type Request } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  Duration,
  DurationParseError,
} from '@tzurot/common-types';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess } from '../../utils/responseHelpers.js';

const logger = createLogger('admin-usage');

/**
 * Parse timeframe string (e.g., '7d', '30d', '24h') to a Date
 * Uses shared Duration class for parsing
 */
function parseTimeframe(timeframe: string): Date | null {
  try {
    const duration = Duration.parse(timeframe);
    if (!duration.isEnabled) {
      return null;
    }
    return duration.getCutoffDate();
  } catch (error) {
    if (error instanceof DurationParseError) {
      return null;
    }
    throw error;
  }
}

/**
 * Admin usage stats response
 */
interface AdminUsageStats {
  timeframe: string;
  periodStart: string | null;
  periodEnd: string;
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalTokens: number;
  uniqueUsers: number;
  byProvider: Record<string, { requests: number; tokensIn: number; tokensOut: number }>;
  byModel: Record<string, { requests: number; tokensIn: number; tokensOut: number }>;
  byRequestType: Record<string, { requests: number; tokensIn: number; tokensOut: number }>;
  topUsers: { discordId: string; requests: number; tokens: number }[];
}

export function createAdminUsageRoutes(prisma: PrismaClient): Router {
  const router = Router();

  /**
   * GET /admin/usage
   * Get global token usage statistics
   *
   * Query params:
   * - timeframe: '24h', '7d', '30d', etc. (default: '7d')
   */
  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const timeframe = (req.query.timeframe as string) ?? '7d';
      const periodStart = parseTimeframe(timeframe);

      // Build where clause
      const where: { createdAt?: { gte: Date } } = {};
      if (periodStart !== null) {
        where.createdAt = { gte: periodStart };
      }

      // Get all usage logs for the period
      const usageLogs = await prisma.usageLog.findMany({
        where,
        select: {
          userId: true,
          provider: true,
          model: true,
          tokensIn: true,
          tokensOut: true,
          requestType: true,
        },
      });

      // Get user discord IDs for the user IDs we found
      const userIds = [...new Set(usageLogs.map(log => log.userId))];
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, discordId: true },
      });
      const userIdToDiscordId = new Map(users.map(u => [u.id, u.discordId]));

      // Aggregate stats
      const stats: AdminUsageStats = {
        timeframe,
        periodStart: periodStart?.toISOString() ?? null,
        periodEnd: new Date().toISOString(),
        totalRequests: usageLogs.length,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalTokens: 0,
        uniqueUsers: userIds.length,
        byProvider: {},
        byModel: {},
        byRequestType: {},
        topUsers: [],
      };

      // Track per-user usage for top users
      const userUsage = new Map<string, { requests: number; tokens: number }>();

      for (const log of usageLogs) {
        const tokens = log.tokensIn + log.tokensOut;

        // Totals
        stats.totalTokensIn += log.tokensIn;
        stats.totalTokensOut += log.tokensOut;
        stats.totalTokens += tokens;

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

        // Per-user tracking
        const discordId = userIdToDiscordId.get(log.userId) ?? log.userId;
        const existing = userUsage.get(discordId) ?? { requests: 0, tokens: 0 };
        existing.requests++;
        existing.tokens += tokens;
        userUsage.set(discordId, existing);
      }

      // Get top 10 users by token usage
      stats.topUsers = [...userUsage.entries()]
        .map(([discordId, usage]) => ({ discordId, ...usage }))
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 10);

      logger.info(
        {
          timeframe,
          totalRequests: stats.totalRequests,
          totalTokens: stats.totalTokens,
          uniqueUsers: stats.uniqueUsers,
        },
        '[AdminUsage] Returned global usage stats'
      );

      sendCustomSuccess(res, stats, StatusCodes.OK);
    })
  );

  return router;
}
