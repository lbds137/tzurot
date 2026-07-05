/**
 * POST /wallet/test
 * Test API key validity
 *
 * Validates the stored API key by making a dry-run API call
 */

import { Router, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { TestWalletKeySchema } from '@tzurot/common-types/schemas/api/wallet';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { decryptApiKey } from '@tzurot/common-types/utils/encryption';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { validateApiKey } from '../../utils/apiKeyValidation.js';
import type { ProvisionedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

type WalletTestDeps = Pick<RouteDeps, 'prisma'>;

const logger = createLogger('wallet-test-key');

/** POST /api/user/wallet/test — verify a stored API key against the provider. */
export const handleTestWalletKey = (deps: WalletTestDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const parseResult = TestWalletKeySchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const { provider } = parseResult.data;
    const discordUserId = req.userId;

    const userId = resolveProvisionedUserId(req);

    // Get the stored API key
    const storedKey = await prisma.userApiKey.findFirst({
      where: {
        userId,
        provider,
      },
      select: {
        iv: true,
        content: true,
        tag: true,
      },
    });

    if (!storedKey) {
      sendError(res, ErrorResponses.notFound(`API key for ${provider}`));
      return;
    }

    // Decrypt the API key
    let apiKey: string;
    try {
      apiKey = decryptApiKey({
        iv: storedKey.iv,
        content: storedKey.content,
        tag: storedKey.tag,
      });
    } catch (error) {
      logger.error({ err: error, provider, discordUserId }, 'Failed to decrypt API key');
      sendError(res, ErrorResponses.internalError('Failed to decrypt stored API key'));
      return;
    }

    // Validate the API key
    logger.info({ provider, discordUserId }, 'Testing API key');

    const validation = await validateApiKey(apiKey, provider);

    if (!validation.valid) {
      logger.warn(
        { provider, discordUserId, error: validation.error },
        'API key validation failed'
      );

      sendCustomSuccess(
        res,
        {
          valid: false,
          provider,
          error: validation.error,
          timestamp: new Date().toISOString(),
        },
        StatusCodes.OK // Still 200, but valid=false indicates the key is invalid
      );
      return;
    }

    // Update lastUsedAt since we just validated
    await prisma.userApiKey.updateMany({
      where: {
        userId,
        provider,
      },
      data: {
        lastUsedAt: new Date(),
      },
    });

    logger.info(
      { provider, discordUserId, hasCredits: validation.credits !== undefined },
      'API key validated successfully'
    );

    sendCustomSuccess(res, {
      valid: true,
      provider,
      credits: validation.credits,
      timestamp: new Date().toISOString(),
    });
  });
};

export function createTestKeyRoute(prisma: PrismaClient): Router {
  const router = Router();
  router.post(
    '/',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    handleTestWalletKey({ prisma })
  );
  return router;
}
