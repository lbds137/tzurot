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
  encryptApiKey,
  WALLET_ERROR_MESSAGES,
  UserService,
  type PrismaClient,
  type ApiKeyCacheInvalidationService,
  generateUserApiKeyUuid,
  SetWalletKeySchema,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses, type ErrorResponse } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { validateApiKey, type ApiKeyValidationResult } from '../../utils/apiKeyValidation.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('wallet-set-key');

/**
 * Map API key validation error to HTTP error response
 */
function mapValidationErrorToResponse(validation: ApiKeyValidationResult): ErrorResponse {
  switch (validation.errorCode) {
    case 'INVALID_KEY':
      return ErrorResponses.unauthorized(validation.error ?? WALLET_ERROR_MESSAGES.INVALID_API_KEY);
    case 'QUOTA_EXCEEDED':
      return ErrorResponses.paymentRequired(
        validation.error ?? WALLET_ERROR_MESSAGES.INSUFFICIENT_CREDITS
      );
    default:
      return ErrorResponses.validationError(
        validation.error ?? WALLET_ERROR_MESSAGES.VALIDATION_FAILED
      );
  }
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
      const parseResult = SetWalletKeySchema.safeParse(req.body);
      if (!parseResult.success) {
        return sendZodError(res, parseResult.error);
      }

      const { provider, apiKey } = parseResult.data;
      const discordUserId = req.userId;

      logger.info({ provider, discordUserId }, '[Wallet] Validating API key');

      // Validate the API key with the provider
      const validation = await validateApiKey(apiKey, provider);
      if (!validation.valid) {
        logger.warn(
          { provider, discordUserId, errorCode: validation.errorCode },
          '[Wallet] API key validation failed'
        );
        return sendError(res, mapValidationErrorToResponse(validation));
      }

      // Ensure user exists and get internal user ID
      const userId = await userService.getOrCreateUser(discordUserId, discordUserId);
      if (userId === null) {
        return sendError(res, ErrorResponses.validationError('Cannot create user for bot'));
      }

      // Encrypt and store the API key
      const encrypted = encryptApiKey(apiKey);
      await prisma.userApiKey.upsert({
        where: { userId_provider: { userId, provider } },
        update: {
          iv: encrypted.iv,
          content: encrypted.content,
          tag: encrypted.tag,
          isActive: true,
          updatedAt: new Date(),
        },
        create: {
          id: generateUserApiKeyUuid(userId, provider),
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
