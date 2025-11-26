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

const logger = createLogger('wallet-set-key');

/** Timeout for API key validation requests (10 seconds) */
const VALIDATION_TIMEOUT_MS = 10000;

interface SetKeyRequest {
  provider: AIProvider;
  apiKey: string;
}

interface ValidationResult {
  valid: boolean;
  credits?: number;
  error?: string;
  errorCode?: 'INVALID_KEY' | 'QUOTA_EXCEEDED' | 'TIMEOUT' | 'UNKNOWN';
}

/**
 * Validate an OpenRouter API key
 */
async function validateOpenRouterKey(apiKey: string): Promise<ValidationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 401 || response.status === 403) {
      return { valid: false, errorCode: 'INVALID_KEY', error: 'Invalid API key' };
    }

    if (!response.ok) {
      return { valid: false, errorCode: 'UNKNOWN', error: `HTTP ${response.status}` };
    }

    const data = (await response.json()) as { data?: { limit_remaining?: number } };
    const credits = data.data?.limit_remaining;

    // Check if quota is available
    if (credits !== undefined && credits <= 0) {
      return {
        valid: false,
        errorCode: 'QUOTA_EXCEEDED',
        error: 'API key has no remaining credits',
        credits,
      };
    }

    return { valid: true, credits };
  } catch (error) {
    clearTimeout(timeout);

    if (error instanceof Error && error.name === 'AbortError') {
      return { valid: false, errorCode: 'TIMEOUT', error: 'Validation request timed out' };
    }

    return {
      valid: false,
      errorCode: 'UNKNOWN',
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  }
}

/**
 * Validate an OpenAI API key
 */
async function validateOpenAIKey(apiKey: string): Promise<ValidationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);

  try {
    // Use the models endpoint for lightweight validation
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 401) {
      return { valid: false, errorCode: 'INVALID_KEY', error: 'Invalid API key' };
    }

    if (response.status === 429) {
      return { valid: false, errorCode: 'QUOTA_EXCEEDED', error: 'Rate limit exceeded' };
    }

    if (!response.ok) {
      return { valid: false, errorCode: 'UNKNOWN', error: `HTTP ${response.status}` };
    }

    return { valid: true };
  } catch (error) {
    clearTimeout(timeout);

    if (error instanceof Error && error.name === 'AbortError') {
      return { valid: false, errorCode: 'TIMEOUT', error: 'Validation request timed out' };
    }

    return {
      valid: false,
      errorCode: 'UNKNOWN',
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  }
}

/**
 * Validate API key for a provider
 */
async function validateApiKey(apiKey: string, provider: AIProvider): Promise<ValidationResult> {
  switch (provider) {
    case AIProvider.OpenRouter:
      return validateOpenRouterKey(apiKey);
    case AIProvider.OpenAI:
      return validateOpenAIKey(apiKey);
    default:
      return { valid: false, errorCode: 'UNKNOWN', error: 'Unknown provider' };
  }
}

/**
 * Ensure user exists in database
 * Creates user if not exists (Discord user ID as ID)
 */
async function ensureUserExists(prisma: PrismaClient, discordUserId: string): Promise<string> {
  // Discord IDs are snowflakes (numeric strings), but our user IDs are UUIDs
  // We need to check if a user with this Discord ID exists
  let user = await prisma.user.findFirst({
    where: { discordId: discordUserId },
    select: { id: true },
  });

  if (!user) {
    // Create new user with Discord ID
    // Use discordId as placeholder username (can be updated later via other flows)
    user = await prisma.user.create({
      data: {
        discordId: discordUserId,
        username: discordUserId,
        timezone: 'UTC',
      },
      select: { id: true },
    });
    logger.info({ discordUserId }, '[Wallet] Created new user');
  }

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
