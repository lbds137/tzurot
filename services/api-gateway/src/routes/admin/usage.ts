/**
 * Admin Usage Routes
 * GET /admin/usage - Get global token usage statistics (all users)
 */

import { Router, type Response, type Request, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { Duration, DurationParseError } from '@tzurot/common-types/utils/Duration';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { shortModelName } from '@tzurot/common-types/utils/modelNames';
import { requireOwnerAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ZAI_PLAN_METER_SNAPSHOT_KEY } from '@tzurot/common-types/constants/redis-keys';
import { sendCustomSuccess } from '../../utils/responseHelpers.js';
import type { RouteDeps } from '../routeDeps.js';

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
  /** True if results were truncated due to query limits */
  limitReached?: boolean;
  /** Live z.ai plan meters from the ai-worker snapshot; absent when none. */
  zaiPlan?: {
    tighterWindowConsumedPct: number;
    resetAt: string | null;
    fetchedAt: string;
  };
}

/**
 * Live z.ai coding-plan meters — ai-worker mirrors its ZaiPlanMeter reading to
 * a short-TTL Redis snapshot so this route can render plan pressure without
 * holding the coding-plan key. Absent/stale/no-redis ⇒ undefined (omitted).
 */
async function readZaiPlanSnapshot(redis: RouteDeps['redis']): Promise<AdminUsageStats['zaiPlan']> {
  if (redis === undefined) {
    return undefined;
  }
  try {
    const snapshot = await redis.get(ZAI_PLAN_METER_SNAPSHOT_KEY);
    if (snapshot === null) {
      return undefined;
    }
    const parsed = JSON.parse(snapshot) as {
      tighterWindowConsumedPct?: number;
      resetAt?: string | null;
      fetchedAt?: string;
    };
    if (
      typeof parsed.tighterWindowConsumedPct !== 'number' ||
      typeof parsed.fetchedAt !== 'string'
    ) {
      return undefined;
    }
    return {
      tighterWindowConsumedPct: parsed.tighterWindowConsumedPct,
      resetAt: parsed.resetAt ?? null,
      fetchedAt: parsed.fetchedAt,
    };
  } catch (error) {
    logger.warn({ err: error }, 'Failed to read z.ai plan meter snapshot');
    return undefined;
  }
}

/**
 * GET /api/admin/usage — Get global token usage statistics.
 * Query params: timeframe ('24h', '7d', '30d', etc.; default '7d')
 */
export const handleGetAdminUsageStats = (deps: RouteDeps): RequestHandler => {
  const { prisma, redis } = deps;
  return asyncHandler(async (req: Request, res: Response) => {
    const timeframe = (req.query.timeframe as string) ?? '7d';
    const periodStart = parseTimeframe(timeframe);

    // Build where clause
    const where: { createdAt?: { gte: Date } } = {};
    if (periodStart !== null) {
      where.createdAt = { gte: periodStart };
    }

    // Get usage logs for the period (bounded to prevent OOM on large datasets)
    const MAX_USAGE_LOGS = 50000;
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
      take: MAX_USAGE_LOGS,
      orderBy: { createdAt: 'desc' },
    });
    const limitReached = usageLogs.length === MAX_USAGE_LOGS;

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
      limitReached,
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
      'Returned global usage stats'
    );

    stats.zaiPlan = await readZaiPlanSnapshot(redis);

    sendCustomSuccess(res, stats, StatusCodes.OK);
  });
};

export function createAdminUsageRoutes(deps: RouteDeps): Router {
  const router = Router();
  router.get('/', requireOwnerAuth(), handleGetAdminUsageStats(deps));
  return router;
}
