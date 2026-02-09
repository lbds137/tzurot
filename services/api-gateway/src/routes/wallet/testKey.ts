/**
 * POST /wallet/test
 * Test API key validity
 *
 * Validates the stored API key by making a dry-run API call
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  decryptApiKey,
  type PrismaClient,
  TestWalletKeySchema,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { validateApiKey } from '../../utils/apiKeyValidation.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('wallet-test-key');

export function createTestKeyRoute(prisma: PrismaClient): Router {
  const router = Router();

  router.post(
    '/',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const parseResult = TestWalletKeySchema.safeParse(req.body);
      if (!parseResult.success) {
        return sendZodError(res, parseResult.error);
      }

      const { provider } = parseResult.data;
      const discordUserId = req.userId;

      // Find user by Discord ID
      const user = await prisma.user.findFirst({
        where: { discordId: discordUserId },
        select: { id: true },
      });

      if (!user) {
        sendError(res, ErrorResponses.notFound(`API key for ${provider}`));
        return;
      }

      // Get the stored API key
      const storedKey = await prisma.userApiKey.findFirst({
        where: {
          userId: user.id,
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
        logger.error({ err: error, provider, discordUserId }, '[Wallet] Failed to decrypt API key');
        sendError(res, ErrorResponses.internalError('Failed to decrypt stored API key'));
        return;
      }

      // Validate the API key
      logger.info({ provider, discordUserId }, '[Wallet] Testing API key');

      const validation = await validateApiKey(apiKey, provider);

      if (!validation.valid) {
        logger.warn(
          { provider, discordUserId, error: validation.error },
          '[Wallet] API key validation failed'
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
          userId: user.id,
          provider,
        },
        data: {
          lastUsedAt: new Date(),
        },
      });

      logger.info(
        { provider, discordUserId, hasCredits: validation.credits !== undefined },
        '[Wallet] API key validated successfully'
      );

      sendCustomSuccess(res, {
        valid: true,
        provider,
        credits: validation.credits,
        timestamp: new Date().toISOString(),
      });
    })
  );

  return router;
}
