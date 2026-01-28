/**
 * User History Routes
 * STM (Short-Term Memory) management via context epochs
 *
 * Per-persona epoch tracking: Each user's persona has independent history visibility.
 * Uses UserPersonaHistoryConfig table for per-persona epoch storage.
 *
 * POST /user/history/clear - Set context epoch (soft reset)
 * POST /user/history/undo - Restore previous epoch
 * GET /user/history/stats - Get history statistics
 */

import { Router, type Response, type Request } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  ConversationHistoryService,
  ConversationRetentionService,
  generateUserPersonaHistoryConfigUuid,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { resolveHistoryContext } from '../../utils/historyContextResolver.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('user-history');

interface ClearHistoryRequest {
  personalitySlug: string;
  /** Optional persona ID - if not provided, uses resolved persona */
  personaId?: string;
}

interface UndoHistoryRequest {
  personalitySlug: string;
  /** Optional persona ID - if not provided, uses resolved persona */
  personaId?: string;
}

interface HardDeleteRequest {
  personalitySlug: string;
  channelId: string;
  personaId?: string; // Optional - if not provided, uses resolved persona
}

interface StatsRequest {
  personalitySlug?: string;
  channelId?: string;
  personaId?: string;
}

/** Dependencies for history handlers */
interface HistoryHandlerDeps {
  prisma: PrismaClient;
  conversationHistoryService: ConversationHistoryService;
  retentionService: ConversationRetentionService;
}

type RouteHandler = (req: Request, res: Response) => void;

/**
 * Handle POST /user/history/clear
 * Set context epoch to current time (soft reset)
 */
function createClearHandler(deps: HistoryHandlerDeps): RouteHandler {
  const { prisma } = deps;

  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const { personalitySlug, personaId: explicitPersonaId } = req.body as ClearHistoryRequest;

    if (!personalitySlug || personalitySlug.length === 0) {
      return sendError(res, ErrorResponses.validationError('personalitySlug is required'));
    }

    const context = await resolveHistoryContext(
      prisma,
      discordUserId,
      personalitySlug,
      explicitPersonaId
    );
    if (!context) {
      return sendError(
        res,
        ErrorResponses.notFound(
          'User, personality, or persona not found. Check the personality slug is correct and you have a persona configured.'
        )
      );
    }

    const { userId, personalityId, personaId } = context;
    const now = new Date();

    // Use transaction for atomic read-modify-write
    const { previousEpoch } = await prisma.$transaction(async tx => {
      const currentConfig = await tx.userPersonaHistoryConfig.findUnique({
        where: { userId_personalityId_personaId: { userId, personalityId, personaId } },
        select: { lastContextReset: true },
      });

      const prevEpoch = currentConfig?.lastContextReset ?? null;

      await tx.userPersonaHistoryConfig.upsert({
        where: { userId_personalityId_personaId: { userId, personalityId, personaId } },
        update: { lastContextReset: now, previousContextReset: prevEpoch },
        create: {
          id: generateUserPersonaHistoryConfigUuid(userId, personalityId, personaId),
          userId,
          personalityId,
          personaId,
          lastContextReset: now,
          previousContextReset: null,
        },
      });

      return { previousEpoch: prevEpoch };
    });

    logger.info(
      {
        discordUserId,
        personalitySlug,
        personaId: personaId.substring(0, 8),
        epoch: now.toISOString(),
      },
      '[History] Context cleared (epoch set)'
    );

    sendCustomSuccess(
      res,
      {
        success: true,
        epoch: now.toISOString(),
        personaId,
        canUndo: previousEpoch !== null,
        message:
          'Conversation context cleared. Previous messages will not be included in AI context.',
      },
      StatusCodes.OK
    );
  });
}

/**
 * Handle POST /user/history/undo
 * Restore previous context epoch
 */
function createUndoHandler(deps: HistoryHandlerDeps): RouteHandler {
  const { prisma } = deps;

  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const { personalitySlug, personaId: explicitPersonaId } = req.body as UndoHistoryRequest;

    if (!personalitySlug || personalitySlug.length === 0) {
      return sendError(res, ErrorResponses.validationError('personalitySlug is required'));
    }

    const context = await resolveHistoryContext(
      prisma,
      discordUserId,
      personalitySlug,
      explicitPersonaId
    );
    if (!context) {
      return sendError(
        res,
        ErrorResponses.notFound(
          'User, personality, or persona not found. Check the personality slug is correct and you have a persona configured.'
        )
      );
    }

    const { userId, personalityId, personaId } = context;

    const result = await prisma.$transaction(async tx => {
      const currentConfig = await tx.userPersonaHistoryConfig.findUnique({
        where: { userId_personalityId_personaId: { userId, personalityId, personaId } },
        select: { lastContextReset: true, previousContextReset: true },
      });

      if (
        currentConfig?.lastContextReset === null ||
        currentConfig?.lastContextReset === undefined
      ) {
        return { success: false as const, reason: 'no-clear' as const };
      }

      const restoredEpoch = currentConfig.previousContextReset;

      await tx.userPersonaHistoryConfig.update({
        where: { userId_personalityId_personaId: { userId, personalityId, personaId } },
        data: { lastContextReset: restoredEpoch, previousContextReset: null },
      });

      return { success: true as const, restoredEpoch };
    });

    if (!result.success) {
      return sendError(
        res,
        ErrorResponses.validationError(
          'No previous context to restore. Undo is only available after a clear operation.'
        )
      );
    }

    logger.info(
      {
        discordUserId,
        personalitySlug,
        personaId: personaId.substring(0, 8),
        restoredEpoch: result.restoredEpoch?.toISOString(),
      },
      '[History] Context restored (undo)'
    );

    sendCustomSuccess(
      res,
      {
        success: true,
        restoredEpoch: result.restoredEpoch?.toISOString() ?? null,
        personaId,
        message: 'Previous context restored. The last clear operation has been undone.',
      },
      StatusCodes.OK
    );
  });
}

/**
 * Handle GET /user/history/stats
 * Get conversation history statistics
 */
function createStatsHandler(deps: HistoryHandlerDeps): RouteHandler {
  const { prisma, conversationHistoryService } = deps;

  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const { personalitySlug, channelId, personaId: explicitPersonaId } = req.query as StatsRequest;

    if (personalitySlug === undefined || personalitySlug.length === 0) {
      return sendError(
        res,
        ErrorResponses.validationError('personalitySlug query parameter is required')
      );
    }
    if (channelId === undefined || channelId.length === 0) {
      return sendError(
        res,
        ErrorResponses.validationError('channelId query parameter is required')
      );
    }

    const context = await resolveHistoryContext(
      prisma,
      discordUserId,
      personalitySlug,
      explicitPersonaId
    );
    if (!context) {
      return sendError(
        res,
        ErrorResponses.notFound(
          'User, personality, or persona not found. Check the personality slug is correct and you have a persona configured.'
        )
      );
    }

    const { userId, personalityId, personaId, personaName } = context;

    const historyConfig = await prisma.userPersonaHistoryConfig.findUnique({
      where: { userId_personalityId_personaId: { userId, personalityId, personaId } },
      select: { lastContextReset: true, previousContextReset: true },
    });

    const epoch = historyConfig?.lastContextReset ?? undefined;

    const [visibleStats, totalStats] = await Promise.all([
      conversationHistoryService.getHistoryStats(channelId, personalityId, epoch),
      conversationHistoryService.getHistoryStats(channelId, personalityId, undefined),
    ]);

    const hiddenMessages = totalStats.totalMessages - visibleStats.totalMessages;

    logger.debug(
      { discordUserId, personalitySlug, channelId, personaId: personaId.substring(0, 8) },
      '[History] Stats retrieved'
    );

    sendCustomSuccess(
      res,
      {
        channelId,
        personalitySlug,
        personaId,
        personaName,
        visible: {
          totalMessages: visibleStats.totalMessages,
          userMessages: visibleStats.userMessages,
          assistantMessages: visibleStats.assistantMessages,
          oldestMessage: visibleStats.oldestMessage?.toISOString() ?? null,
          newestMessage: visibleStats.newestMessage?.toISOString() ?? null,
        },
        hidden: { count: hiddenMessages },
        total: {
          totalMessages: totalStats.totalMessages,
          oldestMessage: totalStats.oldestMessage?.toISOString() ?? null,
        },
        contextEpoch: epoch?.toISOString() ?? null,
        canUndo:
          historyConfig?.previousContextReset !== null &&
          historyConfig?.previousContextReset !== undefined,
      },
      StatusCodes.OK
    );
  });
}

/**
 * Handle DELETE /user/history/hard-delete
 * Permanently delete conversation history
 */
function createHardDeleteHandler(deps: HistoryHandlerDeps): RouteHandler {
  const { prisma, retentionService } = deps;

  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const {
      personalitySlug,
      channelId,
      personaId: explicitPersonaId,
    } = req.body as HardDeleteRequest;

    if (!personalitySlug || personalitySlug.length === 0) {
      return sendError(res, ErrorResponses.validationError('personalitySlug is required'));
    }
    if (!channelId || channelId.length === 0) {
      return sendError(res, ErrorResponses.validationError('channelId is required'));
    }

    const context = await resolveHistoryContext(
      prisma,
      discordUserId,
      personalitySlug,
      explicitPersonaId
    );
    if (!context) {
      return sendError(
        res,
        ErrorResponses.notFound(
          'User, personality, or persona not found. Check the personality slug is correct and you have a persona configured.'
        )
      );
    }

    const { userId, personalityId, personaId } = context;

    const deletedCount = await retentionService.clearHistory(channelId, personalityId, personaId);

    const now = new Date();
    await prisma.userPersonaHistoryConfig.upsert({
      where: { userId_personalityId_personaId: { userId, personalityId, personaId } },
      update: { lastContextReset: now, previousContextReset: null },
      create: {
        id: generateUserPersonaHistoryConfigUuid(userId, personalityId, personaId),
        userId,
        personalityId,
        personaId,
        lastContextReset: now,
        previousContextReset: null,
      },
    });

    logger.info(
      {
        discordUserId,
        personalitySlug,
        channelId,
        personaId: personaId.substring(0, 8),
        deletedCount,
      },
      '[History] Hard delete completed'
    );

    sendCustomSuccess(
      res,
      {
        success: true,
        deletedCount,
        personaId,
        message: `Permanently deleted ${deletedCount} message${deletedCount === 1 ? '' : 's'} from conversation history.`,
      },
      StatusCodes.OK
    );
  });
}

export function createHistoryRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const deps: HistoryHandlerDeps = {
    prisma,
    conversationHistoryService: new ConversationHistoryService(prisma),
    retentionService: new ConversationRetentionService(prisma),
  };

  // POST /user/history/clear - Set context epoch (soft reset)
  router.post('/clear', requireUserAuth(), createClearHandler(deps));

  // POST /user/history/undo - Restore previous epoch
  router.post('/undo', requireUserAuth(), createUndoHandler(deps));

  // GET /user/history/stats - Get history statistics
  router.get('/stats', requireUserAuth(), createStatsHandler(deps));

  // DELETE /user/history/hard-delete - Permanently delete history
  router.delete('/hard-delete', requireUserAuth(), createHardDeleteHandler(deps));

  return router;
}
