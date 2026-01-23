/**
 * Admin Diagnostic Routes
 * Owner-only endpoints for accessing LLM diagnostic logs (flight recorder)
 *
 * Endpoints:
 * - GET /admin/diagnostic/recent - List recent diagnostic logs (last 100)
 * - GET /admin/diagnostic/by-message/:messageId - Get logs by Discord message ID
 * - GET /admin/diagnostic/:requestId - Get diagnostic log by request ID
 *
 * Note: Diagnostic logs are ephemeral (24h retention) and stored for debugging
 * prompt construction issues.
 */

import { Router, type Response, type Request, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, type PrismaClient, type DiagnosticPayload } from '@tzurot/common-types';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { getParam } from '../../utils/requestParams.js';

const logger = createLogger('admin-diagnostic');

/** Maximum number of recent logs to return */
const MAX_RECENT_LOGS = 100;

/** Response format for a single diagnostic log */
interface DiagnosticLogResponse {
  id: string;
  requestId: string;
  triggerMessageId: string | null;
  personalityId: string | null;
  userId: string | null;
  guildId: string | null;
  channelId: string | null;
  model: string;
  provider: string;
  durationMs: number;
  createdAt: Date;
  data: DiagnosticPayload;
}

/**
 * Format a diagnostic log for API response
 */
function formatLogResponse(log: {
  id: string;
  requestId: string;
  triggerMessageId: string | null;
  personalityId: string | null;
  userId: string | null;
  guildId: string | null;
  channelId: string | null;
  model: string;
  provider: string;
  durationMs: number;
  createdAt: Date;
  data: unknown;
}): DiagnosticLogResponse {
  return {
    id: log.id,
    requestId: log.requestId,
    triggerMessageId: log.triggerMessageId,
    personalityId: log.personalityId,
    userId: log.userId,
    guildId: log.guildId,
    channelId: log.channelId,
    model: log.model,
    provider: log.provider,
    durationMs: log.durationMs,
    createdAt: log.createdAt,
    data: log.data as DiagnosticPayload,
  };
}

/**
 * Handler: GET /admin/diagnostic/recent
 * List recent diagnostic logs (last 100)
 */
function handleGetRecent(prisma: PrismaClient): RequestHandler {
  return asyncHandler(async (req: Request, res: Response) => {
    const personalityId = getParam(req.query.personalityId as string | undefined);
    const userId = getParam(req.query.userId as string | undefined);
    const channelId = getParam(req.query.channelId as string | undefined);

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
      },
    });

    logger.info(
      { count: logs.length, filters: { personalityId, userId, channelId } },
      '[AdminDiagnostic] Listed recent diagnostic logs'
    );

    sendCustomSuccess(res, { logs, count: logs.length }, StatusCodes.OK);
  });
}

/**
 * Handler: GET /admin/diagnostic/by-message/:messageId
 * Get all diagnostic logs for a Discord message ID
 */
function handleGetByMessage(prisma: PrismaClient): RequestHandler {
  return asyncHandler(async (req: Request, res: Response) => {
    const messageId = getParam(req.params.messageId);

    if (messageId === undefined || messageId === '') {
      sendError(res, ErrorResponses.validationError('Message ID is required'));
      return;
    }

    const logs = await prisma.llmDiagnosticLog.findMany({
      where: { triggerMessageId: messageId },
      orderBy: { createdAt: 'desc' },
    });

    if (logs.length === 0) {
      sendError(
        res,
        ErrorResponses.notFound('Diagnostic logs for message (may have expired - 24h retention)')
      );
      return;
    }

    logger.info(
      { messageId, count: logs.length },
      '[AdminDiagnostic] Retrieved diagnostic logs by message ID'
    );

    sendCustomSuccess(
      res,
      { logs: logs.map(formatLogResponse), count: logs.length },
      StatusCodes.OK
    );
  });
}

/**
 * Handler: GET /admin/diagnostic/:requestId
 * Get full diagnostic log by request ID
 */
function handleGetByRequestId(prisma: PrismaClient): RequestHandler {
  return asyncHandler(async (req: Request, res: Response) => {
    const requestId = getParam(req.params.requestId);

    if (requestId === null || requestId === '') {
      sendError(res, ErrorResponses.validationError('Request ID is required'));
      return;
    }

    const log = await prisma.llmDiagnosticLog.findUnique({
      where: { requestId },
    });

    if (!log) {
      sendError(res, ErrorResponses.notFound('Diagnostic log (may have expired - 24h retention)'));
      return;
    }

    logger.info(
      { requestId, personalityId: log.personalityId },
      '[AdminDiagnostic] Retrieved diagnostic log'
    );

    sendCustomSuccess(res, { log: formatLogResponse(log) }, StatusCodes.OK);
  });
}

/**
 * Create diagnostic routes with injected dependencies
 * @param prisma - Prisma client for database operations
 */
export function createDiagnosticRoutes(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/recent', handleGetRecent(prisma));
  router.get('/by-message/:messageId', handleGetByMessage(prisma));
  router.get('/:requestId', handleGetByRequestId(prisma));

  return router;
}
