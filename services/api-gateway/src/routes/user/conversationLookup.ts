/**
 * Conversation Lookup Routes
 * Internal endpoints for conversation data lookups (service-to-service)
 *
 * GET /api/internal/conversation/message-personality - Get personality from Discord message ID
 */

import { type Request, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { ConversationHistoryService } from '@tzurot/conversation-history';
import { internalRoutes } from '@tzurot/clients';
import { withManifestInput } from '../../utils/manifestInput.js';
import { sendCustomSuccess } from '../../utils/responseHelpers.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('conversation-lookup');

interface MessagePersonalityResponse {
  personalityId: string;
  personalityName?: string;
}

/**
 * GET /api/internal/conversation/message-personality — lookup personality by Discord message ID
 * Internal service-to-service endpoint (no user auth required).
 */
export const handleLookupPersonalityFromMessage = (deps: RouteDeps): RequestHandler => {
  const conversationHistoryService = new ConversationHistoryService(deps.prisma);
  return withManifestInput(
    internalRoutes.lookupPersonalityFromMessage,
    async (_req: Request, res: Response, { query }): Promise<void> => {
      const { discordMessageId } = query;

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
    }
  );
};
