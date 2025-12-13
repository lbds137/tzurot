/**
 * User History Routes
 * STM (Short-Term Memory) management via context epochs
 *
 * POST /user/history/clear - Set context epoch (soft reset)
 * POST /user/history/undo - Restore previous epoch
 * GET /user/history/stats - Get history statistics
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, type PrismaClient, ConversationHistoryService } from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('user-history');

interface ClearHistoryRequest {
  personalitySlug: string;
}

interface UndoHistoryRequest {
  personalitySlug: string;
}

interface HardDeleteRequest {
  personalitySlug: string;
  channelId: string;
}

export function createHistoryRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const conversationHistoryService = new ConversationHistoryService(prisma);

  /**
   * Helper to get user's personality config (or create one)
   * Returns the personality ID and config, or null if personality not found
   */
  async function getUserPersonalityConfig(
    discordUserId: string,
    personalitySlug: string
  ): Promise<{
    userId: string;
    personalityId: string;
    config: {
      id: string;
      lastContextReset: Date | null;
      previousContextReset: Date | null;
    } | null;
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

    // Find or get user's config for this personality
    const config = await prisma.userPersonalityConfig.findUnique({
      where: {
        userId_personalityId: {
          userId: user.id,
          personalityId: personality.id,
        },
      },
      select: {
        id: true,
        lastContextReset: true,
        previousContextReset: true,
      },
    });

    return {
      userId: user.id,
      personalityId: personality.id,
      config,
    };
  }

  /**
   * POST /user/history/clear
   * Set context epoch to current time (soft reset)
   * Messages before this timestamp will be excluded from AI context
   */
  router.post(
    '/clear',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const { personalitySlug } = req.body as ClearHistoryRequest;

      // Validate required field
      if (!personalitySlug || personalitySlug.length === 0) {
        return sendError(res, ErrorResponses.validationError('personalitySlug is required'));
      }

      const result = await getUserPersonalityConfig(discordUserId, personalitySlug);

      if (!result) {
        return sendError(res, ErrorResponses.notFound('User or personality not found'));
      }

      const { userId, personalityId, config } = result;
      const now = new Date();

      // Store current epoch as previous (for undo), set new epoch
      const previousEpoch = config?.lastContextReset ?? null;

      // Upsert the config with new epoch
      await prisma.userPersonalityConfig.upsert({
        where: {
          userId_personalityId: {
            userId,
            personalityId,
          },
        },
        update: {
          lastContextReset: now,
          previousContextReset: previousEpoch,
        },
        create: {
          userId,
          personalityId,
          lastContextReset: now,
          previousContextReset: null,
        },
      });

      logger.info(
        { discordUserId, personalitySlug, epoch: now.toISOString() },
        '[History] Context cleared (epoch set)'
      );

      sendCustomSuccess(
        res,
        {
          success: true,
          epoch: now.toISOString(),
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
   */
  router.post(
    '/undo',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const { personalitySlug } = req.body as UndoHistoryRequest;

      // Validate required field
      if (!personalitySlug || personalitySlug.length === 0) {
        return sendError(res, ErrorResponses.validationError('personalitySlug is required'));
      }

      const result = await getUserPersonalityConfig(discordUserId, personalitySlug);

      if (!result) {
        return sendError(res, ErrorResponses.notFound('User or personality not found'));
      }

      const { userId, personalityId, config } = result;

      // Check if there's a previous epoch to restore
      if (config?.previousContextReset === null || config?.previousContextReset === undefined) {
        return sendError(
          res,
          ErrorResponses.validationError(
            'No previous context to restore. Undo is only available after a clear operation.'
          )
        );
      }

      // Restore previous epoch, clear the backup
      await prisma.userPersonalityConfig.update({
        where: {
          userId_personalityId: {
            userId,
            personalityId,
          },
        },
        data: {
          lastContextReset: config.previousContextReset,
          previousContextReset: null, // Clear backup - only one undo level
        },
      });

      logger.info(
        {
          discordUserId,
          personalitySlug,
          restoredEpoch: config.previousContextReset?.toISOString(),
        },
        '[History] Context restored (undo)'
      );

      sendCustomSuccess(
        res,
        {
          success: true,
          restoredEpoch: config.previousContextReset?.toISOString() ?? null,
          message: 'Previous context restored. The last clear operation has been undone.',
        },
        StatusCodes.OK
      );
    })
  );

  /**
   * GET /user/history/stats
   * Get conversation history statistics
   * Query params: personalitySlug, channelId
   */
  router.get(
    '/stats',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const { personalitySlug, channelId } = req.query as {
        personalitySlug?: string;
        channelId?: string;
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

      const result = await getUserPersonalityConfig(discordUserId, personalitySlug);

      if (!result) {
        return sendError(res, ErrorResponses.notFound('User or personality not found'));
      }

      const { personalityId, config } = result;

      // Get stats from ConversationHistoryService
      // Pass epoch if set (to show visible vs hidden messages)
      const epoch = config?.lastContextReset ?? undefined;

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

      logger.debug({ discordUserId, personalitySlug, channelId }, '[History] Stats retrieved');

      sendCustomSuccess(
        res,
        {
          channelId,
          personalitySlug,
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
            config?.previousContextReset !== null && config?.previousContextReset !== undefined,
        },
        StatusCodes.OK
      );
    })
  );

  /**
   * DELETE /user/history/hard-delete
   * Permanently delete conversation history for a channel + personality
   * This is a destructive operation - data cannot be recovered
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

      const result = await getUserPersonalityConfig(discordUserId, personalitySlug);

      if (!result) {
        return sendError(res, ErrorResponses.notFound('User or personality not found'));
      }

      const { userId, personalityId, config } = result;

      // Delete conversation history for this channel + personality
      const deletedCount = await conversationHistoryService.clearHistory(channelId, personalityId);

      // Also clear the context epoch (since all history is gone)
      if (config !== null) {
        await prisma.userPersonalityConfig.update({
          where: {
            userId_personalityId: {
              userId,
              personalityId,
            },
          },
          data: {
            lastContextReset: null,
            previousContextReset: null,
          },
        });
      }

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
