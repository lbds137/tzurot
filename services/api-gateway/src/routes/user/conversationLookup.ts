/**
 * Conversation Lookup Routes
 * Internal endpoints for conversation data lookups (service-to-service)
 *
 * GET /user/conversation/message-personality - Get personality from Discord message ID
 */

import { Router, type Request, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { ConversationHistoryService } from '@tzurot/conversation-history';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { getParam } from '../../utils/requestParams.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('conversation-lookup');

interface MessagePersonalityResponse {
  personalityId: string;
  personalityName?: string;
}

/**
 * GET /api/user/conversation/message-personality — lookup personality by Discord message ID
 * Internal service-to-service endpoint (no user auth required).
 */
export const handleLookupPersonalityFromMessage = (deps: RouteDeps): RequestHandler => {
  const conversationHistoryService = new ConversationHistoryService(deps.prisma);
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const discordMessageId = getParam(req.query.discordMessageId as string | string[] | undefined);

    if (discordMessageId === undefined) {
      sendError(
        res,
        ErrorResponses.validationError('discordMessageId query parameter is required')
      );
      return;
    }

    const message = await conversationHistoryService.getMessageByDiscordId(discordMessageId);

    if (message?.personalityId === undefined) {
      logger.debug({ discordMessageId }, 'No message found for Discord message ID');
      res.status(StatusCodes.NOT_FOUND).json(null);
      return;
    }

    const response: MessagePersonalityResponse = {
      personalityId: message.personalityId,
      personalityName: message.personalityName,
    };

    logger.debug(
      { discordMessageId, personalityId: message.personalityId },
      'Found personality for Discord message'
    );

    sendCustomSuccess(res, response, StatusCodes.OK);
  });
};

export function createConversationLookupRoutes(deps: RouteDeps): Router {
  const router = Router();
  router.get('/message-personality', handleLookupPersonalityFromMessage(deps));
  return router;
}
