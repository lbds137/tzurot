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

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  ConversationHistoryService,
  PersonaResolver,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
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
}

export function createHistoryRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const conversationHistoryService = new ConversationHistoryService(prisma);
  const personaResolver = new PersonaResolver(prisma);

  /**
   * Helper to get user, personality, and resolved persona IDs
   * Returns only IDs - callers fetch historyConfig separately as needed
   */
  async function getHistoryContext(
    discordUserId: string,
    personalitySlug: string,
    explicitPersonaId?: string
  ): Promise<{
    userId: string;
    personalityId: string;
    personaId: string;
  } | null> {
    // Find user
    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
    });

    if (!user) {
      return null;
    }

    // Find personality by slug
    const personality = await prisma.personality.findUnique({
      where: { slug: personalitySlug },
    });

    if (!personality) {
      return null;
    }

    // Resolve persona: use explicit ID or resolve via PersonaResolver
    let personaId: string;
    if (
      explicitPersonaId !== undefined &&
      explicitPersonaId !== null &&
      explicitPersonaId.length > 0
    ) {
      // Verify the persona exists and belongs to this user
      const persona = await prisma.persona.findFirst({
        where: {
          id: explicitPersonaId,
          ownerId: user.id,
        },
      });
      if (!persona) {
        logger.warn(
          { discordUserId, explicitPersonaId },
          '[History] Explicit persona not found or not owned by user'
        );
        return null;
      }
      personaId = explicitPersonaId;
    } else {
      // Resolve persona using the resolver (considers personality override + user default)
      const resolved = await personaResolver.resolve(discordUserId, personality.id);
      if (resolved.source === 'system-default' || !resolved.config.personaId) {
        logger.warn({ discordUserId }, '[History] No persona found for user');
        return null;
      }
      personaId = resolved.config.personaId;
    }

    return {
      userId: user.id,
      personalityId: personality.id,
      personaId,
    };
  }

  /**
   * POST /user/history/clear
   * Set context epoch to current time (soft reset)
   * Messages before this timestamp will be excluded from AI context
   *
   * Optional personaId parameter - if not provided, uses resolved persona
   */
  router.post(
    '/clear',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const { personalitySlug, personaId: explicitPersonaId } = req.body as ClearHistoryRequest;

      // Validate required field
      if (!personalitySlug || personalitySlug.length === 0) {
        return sendError(res, ErrorResponses.validationError('personalitySlug is required'));
      }

      const context = await getHistoryContext(discordUserId, personalitySlug, explicitPersonaId);

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

      // Use transaction for atomic read-modify-write to prevent race condition
      // where concurrent clears could lose undo history
      const { previousEpoch } = await prisma.$transaction(async tx => {
        // Read current config inside transaction
        const currentConfig = await tx.userPersonaHistoryConfig.findUnique({
          where: {
            userId_personalityId_personaId: {
              userId,
              personalityId,
              personaId,
            },
          },
          select: { lastContextReset: true },
        });

        const prevEpoch = currentConfig?.lastContextReset ?? null;

        // Upsert with the atomically-read previous epoch
        await tx.userPersonaHistoryConfig.upsert({
          where: {
            userId_personalityId_personaId: {
              userId,
              personalityId,
              personaId,
            },
          },
          update: {
            lastContextReset: now,
            previousContextReset: prevEpoch,
          },
          create: {
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
    })
  );

  /**
   * POST /user/history/undo
   * Restore previous context epoch
   *
   * Optional personaId parameter - if not provided, uses resolved persona
   */
  router.post(
    '/undo',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const { personalitySlug, personaId: explicitPersonaId } = req.body as UndoHistoryRequest;

      // Validate required field
      if (!personalitySlug || personalitySlug.length === 0) {
        return sendError(res, ErrorResponses.validationError('personalitySlug is required'));
      }

      const context = await getHistoryContext(discordUserId, personalitySlug, explicitPersonaId);

      if (!context) {
        return sendError(
          res,
          ErrorResponses.notFound(
            'User, personality, or persona not found. Check the personality slug is correct and you have a persona configured.'
          )
        );
      }

      const { userId, personalityId, personaId } = context;

      // Use transaction for atomic read-modify-write to prevent race condition
      // where a clear could happen between check and update
      const result = await prisma.$transaction(async tx => {
        // Read current config inside transaction
        const currentConfig = await tx.userPersonaHistoryConfig.findUnique({
          where: {
            userId_personalityId_personaId: {
              userId,
              personalityId,
              personaId,
            },
          },
          select: { previousContextReset: true },
        });

        // Check if there's a previous epoch to restore
        if (
          currentConfig?.previousContextReset === null ||
          currentConfig?.previousContextReset === undefined
        ) {
          return { success: false as const };
        }

        // Restore previous epoch, clear the backup
        await tx.userPersonaHistoryConfig.update({
          where: {
            userId_personalityId_personaId: {
              userId,
              personalityId,
              personaId,
            },
          },
          data: {
            lastContextReset: currentConfig.previousContextReset,
            previousContextReset: null, // Clear backup - only one undo level
          },
        });

        return {
          success: true as const,
          restoredEpoch: currentConfig.previousContextReset,
        };
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
    })
  );

  /**
   * GET /user/history/stats
   * Get conversation history statistics
   * Query params: personalitySlug, channelId, personaId (optional)
   */
  router.get(
    '/stats',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const {
        personalitySlug,
        channelId,
        personaId: explicitPersonaId,
      } = req.query as {
        personalitySlug?: string;
        channelId?: string;
        personaId?: string;
      };

      // Validate required fields
      if (
        personalitySlug === undefined ||
        personalitySlug === null ||
        personalitySlug.length === 0
      ) {
        return sendError(
          res,
          ErrorResponses.validationError('personalitySlug query parameter is required')
        );
      }
      if (channelId === undefined || channelId === null || channelId.length === 0) {
        return sendError(
          res,
          ErrorResponses.validationError('channelId query parameter is required')
        );
      }

      const context = await getHistoryContext(discordUserId, personalitySlug, explicitPersonaId);

      if (!context) {
        return sendError(
          res,
          ErrorResponses.notFound(
            'User, personality, or persona not found. Check the personality slug is correct and you have a persona configured.'
          )
        );
      }

      const { userId, personalityId, personaId } = context;

      // Fetch history config for epoch info
      const historyConfig = await prisma.userPersonaHistoryConfig.findUnique({
        where: {
          userId_personalityId_personaId: {
            userId,
            personalityId,
            personaId,
          },
        },
        select: {
          lastContextReset: true,
          previousContextReset: true,
        },
      });

      // Get stats from ConversationHistoryService
      // Pass epoch if set (to show visible vs hidden messages)
      const epoch = historyConfig?.lastContextReset ?? undefined;

      // Get visible stats (after epoch)
      const visibleStats = await conversationHistoryService.getHistoryStats(
        channelId,
        personalityId,
        epoch
      );

      // Get total stats (all messages, ignoring epoch)
      const totalStats = await conversationHistoryService.getHistoryStats(
        channelId,
        personalityId,
        undefined
      );

      // Calculate hidden messages
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
          // Visible messages (in AI context)
          visible: {
            totalMessages: visibleStats.totalMessages,
            userMessages: visibleStats.userMessages,
            assistantMessages: visibleStats.assistantMessages,
            oldestMessage: visibleStats.oldestMessage?.toISOString() ?? null,
            newestMessage: visibleStats.newestMessage?.toISOString() ?? null,
          },
          // Hidden messages (before epoch)
          hidden: {
            count: hiddenMessages,
          },
          // Total (all stored messages)
          total: {
            totalMessages: totalStats.totalMessages,
            oldestMessage: totalStats.oldestMessage?.toISOString() ?? null,
          },
          // Epoch info
          contextEpoch: epoch?.toISOString() ?? null,
          canUndo:
            historyConfig?.previousContextReset !== null &&
            historyConfig?.previousContextReset !== undefined,
        },
        StatusCodes.OK
      );
    })
  );

  /**
   * DELETE /user/history/hard-delete
   * Permanently delete conversation history for a channel + personality
   * This is a destructive operation - data cannot be recovered
   *
   * Note: This deletes ALL messages for the channel regardless of persona.
   * All per-persona epoch configs for this user+personality are also cleared.
   */
  router.delete(
    '/hard-delete',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const { personalitySlug, channelId } = req.body as HardDeleteRequest;

      // Validate required fields
      if (
        personalitySlug === undefined ||
        personalitySlug === null ||
        personalitySlug.length === 0
      ) {
        return sendError(res, ErrorResponses.validationError('personalitySlug is required'));
      }
      if (channelId === undefined || channelId === null || channelId.length === 0) {
        return sendError(res, ErrorResponses.validationError('channelId is required'));
      }

      // Find user
      const user = await prisma.user.findFirst({
        where: { discordId: discordUserId },
      });

      if (!user) {
        return sendError(res, ErrorResponses.notFound('User not found'));
      }

      // Find personality by slug
      const personality = await prisma.personality.findUnique({
        where: { slug: personalitySlug },
      });

      if (!personality) {
        return sendError(res, ErrorResponses.notFound('Personality not found'));
      }

      // Delete conversation history for this channel + personality
      const deletedCount = await conversationHistoryService.clearHistory(channelId, personality.id);

      // Clear ALL per-persona epoch configs for this user+personality
      // (since all history is gone, the epochs are meaningless)
      await prisma.userPersonaHistoryConfig.deleteMany({
        where: {
          userId: user.id,
          personalityId: personality.id,
        },
      });

      logger.info(
        { discordUserId, personalitySlug, channelId, deletedCount },
        '[History] Hard delete completed'
      );

      sendCustomSuccess(
        res,
        {
          success: true,
          deletedCount,
          message: `Permanently deleted ${deletedCount} message${deletedCount === 1 ? '' : 's'} from conversation history.`,
        },
        StatusCodes.OK
      );
    })
  );

  return router;
}
