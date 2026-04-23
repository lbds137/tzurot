/**
 * DELETE /wallet/:provider
 * Remove an API key for a provider
 */

import { type Response, type RequestHandler } from 'express';
import {
  createLogger,
  AIProvider,
  type PrismaClient,
  type ApiKeyCacheInvalidationService,
} from '@tzurot/common-types';
import {
  requireUserAuth,
  requireProvisionedUser,
  getOrCreateUserService,
} from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { ProvisionedRequest } from '../../types.js';

const logger = createLogger('wallet-remove-key');

/**
 * Create remove key route handlers
 * Returns an array of middleware: [auth, handler]
 */
export function createRemoveKeyRoute(
  prisma: PrismaClient,
  apiKeyCacheInvalidation?: ApiKeyCacheInvalidationService
): RequestHandler[] {
  const userService = getOrCreateUserService(prisma);
  const handler = asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const provider = req.params.provider as AIProvider;

    // Validate provider
    if (!Object.values(AIProvider).includes(provider)) {
      sendError(res, ErrorResponses.validationError(`Invalid provider: ${provider}`));
      return;
    }

    const userId = await resolveProvisionedUserId(req, userService);

    // Find and delete the API key
    const existingKey = await prisma.userApiKey.findFirst({
      where: {
        userId,
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

    logger.info({ provider, discordUserId }, 'API key removed');

    // Publish cache invalidation event for ai-worker instances
    if (apiKeyCacheInvalidation !== undefined) {
      await apiKeyCacheInvalidation.invalidateUserApiKeys(discordUserId);
      logger.debug({ discordUserId }, 'Published API key cache invalidation event');
    }

    sendCustomSuccess(res, {
      success: true,
      provider,
      message: `API key for ${provider} has been removed`,
      timestamp: new Date().toISOString(),
    });
  });

  return [requireUserAuth(), requireProvisionedUser(prisma), handler];
}
