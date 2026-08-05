/**
 * DELETE /api/user/wallet/:provider
 * Remove an API key for a provider
 */

import { type Response, type RequestHandler } from 'express';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { ProvisionedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

type WalletRemoveDeps = Pick<RouteDeps, 'prisma' | 'apiKeyCacheInvalidation'>;

const logger = createLogger('wallet-remove-key');

/** DELETE /api/user/wallet/:provider — remove user's API key for a provider. */
export const handleRemoveWalletKey = (deps: WalletRemoveDeps): RequestHandler => {
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
