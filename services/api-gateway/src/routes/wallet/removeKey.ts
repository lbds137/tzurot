/**
 * DELETE /wallet/:provider
 * Remove an API key for a provider
 */

import { Router, type Request, type Response } from 'express';
import { createLogger, AIProvider, type PrismaClient } from '@tzurot/common-types';
import { extractUserId } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';

const logger = createLogger('wallet-remove-key');

export function createRemoveKeyRoute(prisma: PrismaClient): Router {
  // Note: This returns a handler function, not a Router
  // Because the parent router uses router.delete('/:provider', ...)
  return asyncHandler(async (req: Request, res: Response) => {
    // Extract userId manually since we're not using middleware chain here
    const discordUserId = extractUserId(req);

    if (discordUserId === undefined || discordUserId.length === 0) {
      sendError(res, ErrorResponses.unauthorized('User authentication required'));
      return;
    }

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

    sendCustomSuccess(res, {
      success: true,
      provider,
      message: `API key for ${provider} has been removed`,
      timestamp: new Date().toISOString(),
    });
  }) as unknown as Router;
}
