/**
 * DELETE /wallet/:provider
 * Remove an API key for a provider
 */

import { type Request, type Response, type RequestHandler } from 'express';
import {
  createLogger,
  AIProvider,
  type PrismaClient,
  type ApiKeyCacheInvalidationService,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';

const logger = createLogger('wallet-remove-key');

/**
 * Create remove key route handlers
 * Returns an array of middleware: [auth, handler]
 */
export function createRemoveKeyRoute(
  prisma: PrismaClient,
  apiKeyCacheInvalidation?: ApiKeyCacheInvalidationService
): RequestHandler[] {
  const handler = asyncHandler(async (req: Request, res: Response) => {
    const discordUserId = (req as Request & { userId: string }).userId;
    const provider = req.params.provider as AIProvider;

    // Validate provider
    if (!Object.values(AIProvider).includes(provider)) {
      sendError(res, ErrorResponses.validationError(`Invalid provider: ${provider}`));
      return;
    }

    // Find user by Discord ID
    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    if (!user) {
      sendError(res, ErrorResponses.notFound(`API key for ${provider}`));
      return;
    }

    // Find and delete the API key
    const existingKey = await prisma.userApiKey.findFirst({
      where: {
        userId: user.id,
        provider,
      },
    });

    if (!existingKey) {
      sendError(res, ErrorResponses.notFound(`API key for ${provider}`));
      return;
    }

    await prisma.userApiKey.delete({
      where: { id: existingKey.id },
    });

    logger.info({ provider, discordUserId }, '[Wallet] API key removed');

    // Publish cache invalidation event for ai-worker instances
    if (apiKeyCacheInvalidation !== undefined) {
      await apiKeyCacheInvalidation.invalidateUserApiKeys(discordUserId);
      logger.debug({ discordUserId }, '[Wallet] Published API key cache invalidation event');
    }

    sendCustomSuccess(res, {
      success: true,
      provider,
      message: `API key for ${provider} has been removed`,
      timestamp: new Date().toISOString(),
    });
  });

  return [requireUserAuth(), handler];
}
