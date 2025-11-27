/**
 * POST /wallet/set
 * Store encrypted API key for a user
 *
 * Security:
 * - Validates key with provider before storage
 * - Encrypts key using AES-256-GCM
 * - Never logs or returns the actual key
 */

import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, AIProvider, encryptApiKey, type PrismaClient } from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { validateApiKey } from '../../utils/apiKeyValidation.js';

const logger = createLogger('wallet-set-key');

interface SetKeyRequest {
  provider: AIProvider;
  apiKey: string;
}

/**
 * Ensure user exists in database
 * Creates user if not exists (Discord user ID as ID)
 * Uses upsert to handle race conditions when multiple requests arrive simultaneously
 */
async function ensureUserExists(prisma: PrismaClient, discordUserId: string): Promise<string> {
  // Use upsert to atomically find-or-create, avoiding race conditions
  const user = await prisma.user.upsert({
    where: { discordId: discordUserId },
    update: {}, // No-op if exists
    create: {
      discordId: discordUserId,
      username: discordUserId, // Placeholder - updated via other flows
      timezone: 'UTC',
    },
    select: { id: true },
  });

  return user.id;
}

export function createSetKeyRoute(prisma: PrismaClient): Router {
  const router = Router();

  router.post(
    '/',
    requireUserAuth(),
    asyncHandler(async (req: Request, res: Response) => {
      const { provider, apiKey } = req.body as SetKeyRequest;
      const discordUserId = (req as Request & { userId: string }).userId;

      // Validate required fields
      if (
        provider === undefined ||
        provider === null ||
        apiKey === undefined ||
        apiKey === null ||
        apiKey.length === 0
      ) {
        return sendError(res, ErrorResponses.validationError('provider and apiKey are required'));
      }

      // Validate provider
      if (!Object.values(AIProvider).includes(provider)) {
        return sendError(res, ErrorResponses.validationError(`Invalid provider: ${provider}`));
      }

      logger.info({ provider, discordUserId }, '[Wallet] Validating API key');

      // Validate the API key with the provider
      const validation = await validateApiKey(apiKey, provider);

      if (!validation.valid) {
        logger.warn(
          { provider, discordUserId, errorCode: validation.errorCode },
          '[Wallet] API key validation failed'
        );

        // Map error codes to HTTP status codes
        switch (validation.errorCode) {
          case 'INVALID_KEY':
            return sendError(
              res,
              ErrorResponses.unauthorized(validation.error ?? 'Invalid API key')
            );
          case 'QUOTA_EXCEEDED':
            return sendError(
              res,
              ErrorResponses.paymentRequired(validation.error ?? 'Insufficient credits')
            );
          default:
            return sendError(
              res,
              ErrorResponses.validationError(validation.error ?? 'Validation failed')
            );
        }
      }

      // Ensure user exists and get internal user ID
      const userId = await ensureUserExists(prisma, discordUserId);

      // Encrypt the API key
      const encrypted = encryptApiKey(apiKey);

      // Upsert the API key (update if exists, create if not)
      await prisma.userApiKey.upsert({
        where: {
          userId_provider: {
            userId,
            provider,
          },
        },
        update: {
          iv: encrypted.iv,
          content: encrypted.content,
          tag: encrypted.tag,
          isActive: true,
          updatedAt: new Date(),
        },
        create: {
          userId,
          provider,
          iv: encrypted.iv,
          content: encrypted.content,
          tag: encrypted.tag,
          isActive: true,
        },
      });

      logger.info(
        { provider, discordUserId, hasCredits: validation.credits !== undefined },
        '[Wallet] API key stored successfully'
      );

      sendCustomSuccess(
        res,
        {
          success: true,
          provider,
          credits: validation.credits,
          timestamp: new Date().toISOString(),
        },
        StatusCodes.OK
      );
    })
  );

  return router;
}
