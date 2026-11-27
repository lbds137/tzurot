/**
 * Conversation Lookup Routes
 * Internal endpoints for conversation data lookups (service-to-service)
 *
 * GET /api/internal/conversation/message-personality - Get personality from Discord message ID
 */

import { type Request, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { ConversationHistoryService, triggerMemoryExists } from '@tzurot/conversation-history';
import { internalRoutes } from '@tzurot/clients';
import { withManifestInput } from '../../utils/manifestInput.js';
import { sendCustomSuccess } from '../../utils/responseHelpers.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('conversation-lookup');

interface MessagePersonalityResponse {
  personalityId: string;
  personalityName?: string;
  personalitySlug?: string;
  role?: string;
  incognito?: boolean | null;
  triggerMemoryExists?: boolean;
}

/**
 * GET /api/internal/conversation/message-personality — lookup personality by Discord message ID
 * Internal service-to-service endpoint (no user auth required).
 * The legacy incognito evidence query is opt-in per caller (`includeIncognitoEvidence`).
 */
export const handleLookupPersonalityFromMessage = (deps: RouteDeps): RequestHandler => {
  const conversationHistoryService = new ConversationHistoryService(deps.prisma);
  return withManifestInput(
    internalRoutes.lookupPersonalityFromMessage,
    async (_req: Request, res: Response, { query }): Promise<void> => {
      const { discordMessageId, includeIncognitoEvidence } = query;

      const message = await conversationHistoryService.getMessageByDiscordId(discordMessageId);

      if (message?.personalityId === undefined) {
        logger.debug({ discordMessageId }, 'No message found for Discord message ID');
        res.status(StatusCodes.NOT_FOUND).json(null);
        return;
      }

      const incognito = message.messageMetadata?.incognito ?? null;
      let hasTriggerMemory: boolean | undefined;
      if (
        includeIncognitoEvidence === true &&
        message.role === MessageRole.Assistant &&
        incognito === null
      ) {
        try {
          hasTriggerMemory = await triggerMemoryExists(deps.prisma, {
            channelId: message.channelId,
            personalityId: message.personalityId,
            createdAt: message.createdAt,
          });
        } catch (error) {
          logger.warn({ err: error, discordMessageId }, 'Legacy incognito evidence lookup failed');
        }
      }

      const response: MessagePersonalityResponse = {
        personalityId: message.personalityId,
        personalityName: message.personalityName,
        personalitySlug: message.personalitySlug,
        role: message.role,
        incognito,
        ...(hasTriggerMemory !== undefined && { triggerMemoryExists: hasTriggerMemory }),
      };

      logger.debug(
        { discordMessageId, personalityId: message.personalityId },
        'Found personality for Discord message'
      );

      sendCustomSuccess(res, response, StatusCodes.OK);
    }
  );
};
