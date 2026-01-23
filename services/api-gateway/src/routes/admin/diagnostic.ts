/**
 * Admin Diagnostic Routes
 * Owner-only endpoints for accessing LLM diagnostic logs (flight recorder)
 *
 * Endpoints:
 * - GET /admin/diagnostic/:requestId - Get diagnostic log by request ID
 * - GET /admin/diagnostic/recent - List recent diagnostic logs (last 100)
 *
 * Note: Diagnostic logs are ephemeral (24h retention) and stored for debugging
 * prompt construction issues.
 */

import { Router, type Response, type Request } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, type PrismaClient, type DiagnosticPayload } from '@tzurot/common-types';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { getParam } from '../../utils/requestParams.js';

const logger = createLogger('admin-diagnostic');

/** Maximum number of recent logs to return */
const MAX_RECENT_LOGS = 100;

/**
 * Create diagnostic routes with injected dependencies
 * @param prisma - Prisma client for database operations
 */
export function createDiagnosticRoutes(prisma: PrismaClient): Router {
  const router = Router();

  /**
   * GET /admin/diagnostic/recent
   * List recent diagnostic logs (last 100)
   *
   * Query params:
   * - personalityId: Filter by personality UUID
   * - userId: Filter by Discord user ID
   * - channelId: Filter by Discord channel ID
   */
  router.get(
    '/recent',
    asyncHandler(async (req: Request, res: Response) => {
      // Extract query parameters
      const personalityId = getParam(req.query.personalityId as string | undefined);
      const userId = getParam(req.query.userId as string | undefined);
      const channelId = getParam(req.query.channelId as string | undefined);

      // Build filter conditions
      const where: Record<string, string> = {};
      if (personalityId !== undefined && personalityId !== '') {
        where.personalityId = personalityId;
      }
      if (userId !== undefined && userId !== '') {
        where.userId = userId;
      }
      if (channelId !== undefined && channelId !== '') {
        where.channelId = channelId;
      }

      const logs = await prisma.llmDiagnosticLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: MAX_RECENT_LOGS,
        select: {
          id: true,
          requestId: true,
          personalityId: true,
          userId: true,
          guildId: true,
          channelId: true,
          model: true,
          provider: true,
          durationMs: true,
          createdAt: true,
          // Don't include full data blob in list view - too large
        },
      });

      logger.info(
        { count: logs.length, filters: { personalityId, userId, channelId } },
        '[AdminDiagnostic] Listed recent diagnostic logs'
      );

      sendCustomSuccess(res, { logs, count: logs.length }, StatusCodes.OK);
    })
  );

  /**
   * GET /admin/diagnostic/:requestId
   * Get full diagnostic log by request ID
   */
  router.get(
    '/:requestId',
    asyncHandler(async (req: Request, res: Response) => {
      const requestId = getParam(req.params.requestId);

      if (requestId === null || requestId === '') {
        sendError(res, ErrorResponses.validationError('Request ID is required'));
        return;
      }

      const log = await prisma.llmDiagnosticLog.findUnique({
        where: { requestId },
      });

      if (!log) {
        sendError(
          res,
          ErrorResponses.notFound('Diagnostic log (may have expired - 24h retention)')
        );
        return;
      }

      logger.info(
        { requestId, personalityId: log.personalityId },
        '[AdminDiagnostic] Retrieved diagnostic log'
      );

      // Return the full log including the data payload
      sendCustomSuccess(
        res,
        {
          log: {
            id: log.id,
            requestId: log.requestId,
            personalityId: log.personalityId,
            userId: log.userId,
            guildId: log.guildId,
            channelId: log.channelId,
            model: log.model,
            provider: log.provider,
            durationMs: log.durationMs,
            createdAt: log.createdAt,
            data: log.data as unknown as DiagnosticPayload,
          },
        },
        StatusCodes.OK
      );
    })
  );

  return router;
}
