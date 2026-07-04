/**
 * DELETE /wallet/:provider
 * Remove an API key for a provider
 */

import { type Response, type RequestHandler } from 'express';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type ApiKeyCacheInvalidationService } from '@tzurot/cache-invalidation';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { ProvisionedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('wallet-remove-key');

/**
 * Create remove key route handlers
 * Returns an array of middleware: [auth, handler]
 */
/** DELETE /api/user/wallet/:provider — remove user's API key for a provider. */
export const handleRemoveWalletKey = (deps: RouteDeps): RequestHandler => {
  const { prisma, apiKeyCacheInvalidation } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const provider = req.params.provider as AIProvider;

    // Validate provider
    if (!Object.values(AIProvider).includes(provider)) {
      sendError(res, ErrorResponses.validationError(`Invalid provider: ${provider}`));
      return;
    }

    const userId = resolveProvisionedUserId(req);

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
};

/** Legacy chain. Aggregator spreads the array into `router.delete(...)`. */
export const createRemoveKeyRoute = (
  prisma: PrismaClient,
  apiKeyCacheInvalidation?: ApiKeyCacheInvalidationService
): RequestHandler[] => [
  requireUserAuth(),
  requireProvisionedUser(prisma),
  handleRemoveWalletKey({ prisma, apiKeyCacheInvalidation }),
];
