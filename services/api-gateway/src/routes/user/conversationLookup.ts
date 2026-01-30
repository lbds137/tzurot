/**
 * Conversation Lookup Routes
 * Internal endpoints for conversation data lookups (service-to-service)
 *
 * GET /user/conversation/message-personality - Get personality from Discord message ID
 */

import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, type PrismaClient, ConversationHistoryService } from '@tzurot/common-types';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { getParam } from '../../utils/requestParams.js';

const logger = createLogger('conversation-lookup');

/**
 * Response for message personality lookup
 */
interface MessagePersonalityResponse {
  personalityId: string;
  personalityName?: string;
}

/**
 * Create conversation lookup routes
 * These are internal service-to-service endpoints (no user auth required)
 */
export function createConversationLookupRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const conversationHistoryService = new ConversationHistoryService(prisma);

  /**
   * GET /conversation/message-personality
   *
   * Lookup which personality sent a message by Discord message ID.
   * Used by bot-client to resolve DM reply targets.
   *
   * Query params:
   * - discordMessageId: The Discord snowflake ID to look up
   *
   * Returns:
   * - 200 with { personalityId, personalityName } if found
   * - 404 with null if not found
   */
  router.get(
    '/message-personality',
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
      const discordMessageId = getParam(
        req.query.discordMessageId as string | string[] | undefined
      );

      if (discordMessageId === undefined) {
        sendError(
          res,
          ErrorResponses.validationError('discordMessageId query parameter is required')
        );
        return;
      }

      const message = await conversationHistoryService.getMessageByDiscordId(discordMessageId);

      if (message?.personalityId === undefined) {
        logger.debug(
          { discordMessageId },
          '[ConversationLookup] No message found for Discord message ID'
        );
        res.status(StatusCodes.NOT_FOUND).json(null);
        return;
      }

      const response: MessagePersonalityResponse = {
        personalityId: message.personalityId,
        personalityName: message.personalityName,
      };

      logger.debug(
        { discordMessageId, personalityId: message.personalityId },
        '[ConversationLookup] Found personality for Discord message'
      );

      sendCustomSuccess(res, response, StatusCodes.OK);
    })
  );

  return router;
}
