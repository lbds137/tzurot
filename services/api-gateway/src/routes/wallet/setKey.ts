/**
 * POST /wallet/set
 * Store encrypted API key for a user
 *
 * Security:
 * - Validates key with provider before storage
 * - Encrypts key using AES-256-GCM
 * - Never logs or returns the actual key
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  AIProvider,
  encryptApiKey,
  WALLET_ERROR_MESSAGES,
  UserService,
  type PrismaClient,
  type ApiKeyCacheInvalidationService,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { validateApiKey } from '../../utils/apiKeyValidation.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('wallet-set-key');

interface SetKeyRequest {
  provider: AIProvider;
  apiKey: string;
}

export function createSetKeyRoute(
  prisma: PrismaClient,
  apiKeyCacheInvalidation?: ApiKeyCacheInvalidationService
): Router {
  const router = Router();
  const userService = new UserService(prisma);

  router.post(
    '/',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const { provider, apiKey } = req.body as SetKeyRequest;
      const discordUserId = req.userId;

      // Validate required fields
      if (
        provider === undefined ||
        provider === null ||
        apiKey === undefined ||
        apiKey === null ||
        apiKey.length === 0
      ) {
        return sendError(res, ErrorResponses.validationError(WALLET_ERROR_MESSAGES.MISSING_FIELDS));
      }

      // Validate provider
      if (!Object.values(AIProvider).includes(provider)) {
        return sendError(
          res,
          ErrorResponses.validationError(WALLET_ERROR_MESSAGES.INVALID_PROVIDER(provider))
        );
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
              ErrorResponses.unauthorized(validation.error ?? WALLET_ERROR_MESSAGES.INVALID_API_KEY)
            );
          case 'QUOTA_EXCEEDED':
            return sendError(
              res,
              ErrorResponses.paymentRequired(
                validation.error ?? WALLET_ERROR_MESSAGES.INSUFFICIENT_CREDITS
              )
            );
          default:
            return sendError(
              res,
              ErrorResponses.validationError(
                validation.error ?? WALLET_ERROR_MESSAGES.VALIDATION_FAILED
              )
            );
        }
      }

      // Ensure user exists and get internal user ID
      // Uses centralized UserService - creates "shell user" with placeholder username
      // that will be enriched when user sends a Discord message
      const userId = await userService.getOrCreateUser(discordUserId, discordUserId);
      if (userId === null) {
        // Should not happen for slash commands (bots can't use them)
        return sendError(res, ErrorResponses.validationError('Cannot create user for bot'));
      }

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

      // Publish cache invalidation event for ai-worker instances
      if (apiKeyCacheInvalidation !== undefined) {
        await apiKeyCacheInvalidation.invalidateUserApiKeys(discordUserId);
        logger.debug({ discordUserId }, '[Wallet] Published API key cache invalidation event');
      }

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
