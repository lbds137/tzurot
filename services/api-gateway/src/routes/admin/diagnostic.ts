/**
 * Admin Diagnostic Routes
 * Owner-only endpoints for accessing LLM diagnostic logs (flight recorder)
 *
 * Endpoints:
 * - GET /admin/diagnostic/recent - List recent diagnostic logs (last 100)
 * - GET /admin/diagnostic/by-message/:messageId - Get logs by Discord trigger message ID
 * - GET /admin/diagnostic/by-response/:messageId - Get logs by AI response message ID
 * - GET /admin/diagnostic/:requestId - Get diagnostic log by request ID
 * - PATCH /admin/diagnostic/:requestId/response-ids - Update response message IDs
 *
 * Note: Diagnostic logs are ephemeral (24h retention) and stored for debugging
 * prompt construction issues.
 */

import { Router, type Response, type Request, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  type DiagnosticPayload,
  DiagnosticUpdateSchema,
} from '@tzurot/common-types';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { getParam } from '../../utils/requestParams.js';
import { sendZodError } from '../../utils/zodHelpers.js';

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
    // DiagnosticPayload is written by our own ai-worker pipeline as JSONB — trusted internal data
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
      take: MAX_RECENT_LOGS,
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

    if (requestId === undefined || requestId === '') {
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
 * Handler: GET /admin/diagnostic/by-response/:messageId
 * Get diagnostic log by AI response message ID (array containment query)
 */
function handleGetByResponse(prisma: PrismaClient): RequestHandler {
  return asyncHandler(async (req: Request, res: Response) => {
    const messageId = getParam(req.params.messageId);

    if (messageId === undefined || messageId === '') {
      sendError(res, ErrorResponses.validationError('Message ID is required'));
      return;
    }

    // Use array containment query - responseMessageIds contains messageId
    // findFirst is acceptable since response message IDs are unique per Discord message;
    // even if multiple chunks exist, they all point to the same diagnostic log
    const log = await prisma.llmDiagnosticLog.findFirst({
      where: {
        responseMessageIds: { has: messageId },
      },
    });

    if (!log) {
      sendError(
        res,
        ErrorResponses.notFound(
          'Diagnostic log for response message (may have expired - 24h retention)'
        )
      );
      return;
    }

    logger.info(
      { messageId, requestId: log.requestId },
      '[AdminDiagnostic] Retrieved diagnostic log by response message ID'
    );

    sendCustomSuccess(res, { log: formatLogResponse(log) }, StatusCodes.OK);
  });
}

/**
 * Handler: PATCH /admin/diagnostic/:requestId/response-ids
 * Update the response message IDs for a diagnostic log
 * Called by bot-client after sending response to Discord
 */
function handleUpdateResponseIds(prisma: PrismaClient): RequestHandler {
  return asyncHandler(async (req: Request, res: Response) => {
    const requestId = getParam(req.params.requestId);

    if (requestId === undefined || requestId === '') {
      sendError(res, ErrorResponses.validationError('Request ID is required'));
      return;
    }

    const parseResult = DiagnosticUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const { responseMessageIds } = parseResult.data;

    try {
      await prisma.llmDiagnosticLog.update({
        where: { requestId },
        data: { responseMessageIds },
      });

      logger.info(
        { requestId, responseMessageIds },
        '[AdminDiagnostic] Updated response message IDs'
      );

      sendCustomSuccess(res, { success: true }, StatusCodes.OK);
    } catch (error) {
      // Handle not found case (Prisma throws if record doesn't exist)
      if ((error as { code?: string }).code === 'P2025') {
        sendError(
          res,
          ErrorResponses.notFound('Diagnostic log (may have expired - 24h retention)')
        );
        return;
      }
      throw error;
    }
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
  router.get('/by-response/:messageId', handleGetByResponse(prisma));
  // Note: /:requestId must come after /by-* routes to avoid matching 'by-message' as a requestId
  router.get('/:requestId', handleGetByRequestId(prisma));
  router.patch('/:requestId/response-ids', handleUpdateResponseIds(prisma));

  return router;
}
