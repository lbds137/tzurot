/**
 * Key Validation Service
 *
 * Validates API keys before they are stored in the database.
 * Makes dry-run API calls to verify keys are working.
 *
 * Security considerations:
 * - Keys are validated in ai-worker ONLY (never in api-gateway or bot-client)
 * - Validation calls use minimal tokens to avoid cost
 * - Errors are specific to help users understand failures
 */

import { createLogger, AIProvider, VALIDATION_TIMEOUTS } from '@tzurot/common-types';
import { withTimeout } from '../utils/retryService.js';

const logger = createLogger('KeyValidationService');

/**
 * Error thrown when API key is invalid or rejected by provider
 */
export class InvalidApiKeyError extends Error {
  constructor(
    public readonly provider: AIProvider,
    public readonly reason: string
  ) {
    super(`Invalid API key for ${provider}: ${reason}`);
    this.name = 'InvalidApiKeyError';
  }
}

/**
 * Error thrown when API key is valid but quota/credits exhausted
 */
export class QuotaExceededError extends Error {
  constructor(
    public readonly provider: AIProvider,
    public readonly details?: string
  ) {
    super(
      `Quota exceeded for ${provider}${details !== undefined && details.length > 0 ? `: ${details}` : ''}`
    );
    this.name = 'QuotaExceededError';
  }
}

/**
 * Error thrown when API key validation times out
 */
export class ValidationTimeoutError extends Error {
  constructor(public readonly provider: AIProvider) {
    super(`API key validation timed out for ${provider}`);
    this.name = 'ValidationTimeoutError';
  }
}

/**
 * Result of API key validation
 */
export interface KeyValidationResult {
  /** Whether the key is valid and working */
  valid: boolean;
  /** Provider that was validated */
  provider: AIProvider;
  /** Error if validation failed */
  error?: Error;
  /** Additional metadata from validation */
  metadata?: {
    /** For OpenRouter: credit balance if available */
    creditBalance?: number;
    /** For OpenRouter: models available */
    modelsAvailable?: boolean;
    /** Rate limit info if available */
    rateLimit?: {
      remaining?: number;
      resetAt?: Date;
    };
  };
}

/**
 * Key Validation Service
 * Validates API keys by making dry-run calls to providers
 */
export class KeyValidationService {
  /**
   * Validate an API key for a specific provider
   *
   * @param apiKey - The API key to validate
   * @param provider - The AI provider (openrouter, openai, etc.)
   * @returns Validation result with success/failure details
   */
  async validateKey(apiKey: string, provider: AIProvider): Promise<KeyValidationResult> {
    logger.info({ provider }, '[KeyValidationService] Validating API key');

    try {
      switch (provider) {
        case AIProvider.OpenRouter:
          return await this.validateOpenRouterKey(apiKey);
        case AIProvider.OpenAI:
          return await this.validateOpenAIKey(apiKey);
        default:
          logger.warn({ provider }, '[KeyValidationService] Unsupported provider for validation');
          // For unsupported providers, return valid=true (optimistic)
          return { valid: true, provider };
      }
    } catch (error) {
      logger.error(
        { err: error, provider },
        '[KeyValidationService] Unexpected error during validation'
      );

      if (
        error instanceof InvalidApiKeyError ||
        error instanceof QuotaExceededError ||
        error instanceof ValidationTimeoutError
      ) {
        return { valid: false, provider, error };
      }

      return {
        valid: false,
        provider,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Validate OpenRouter API key
   * Uses the /auth/key endpoint to check key validity and credit balance
   */
  private async validateOpenRouterKey(apiKey: string): Promise<KeyValidationResult> {
    const provider = AIProvider.OpenRouter;

    try {
      // OpenRouter provides an auth endpoint to check key validity
      // https://openrouter.ai/docs#auth-key
      const response = await withTimeout(
        signal =>
          fetch('https://openrouter.ai/api/v1/auth/key', {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
            signal,
          }),
        VALIDATION_TIMEOUTS.API_KEY_VALIDATION,
        'OpenRouter key validation'
      );

      if (response.status === 401) {
        throw new InvalidApiKeyError(provider, 'Key rejected by OpenRouter (401 Unauthorized)');
      }

      if (response.status === 402) {
        throw new QuotaExceededError(provider, 'No credits remaining');
      }

      if (response.status === 429) {
        throw new QuotaExceededError(provider, 'Rate limited - try again later');
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new InvalidApiKeyError(provider, `HTTP ${response.status}: ${errorText}`);
      }

      // Parse response to get credit info
      const data = (await response.json()) as {
        data?: {
          label?: string;
          usage?: number;
          limit?: number;
          is_free_tier?: boolean;
          rate_limit?: {
            requests?: number;
            interval?: string;
          };
        };
      };

      logger.info(
        {
          hasData: !!data?.data,
          isFree: data?.data?.is_free_tier,
          usage: data?.data?.usage,
          limit: data?.data?.limit,
        },
        '[KeyValidationService] OpenRouter key validated successfully'
      );

      return {
        valid: true,
        provider,
        metadata: {
          creditBalance:
            data?.data?.limit !== undefined &&
            data?.data?.limit !== null &&
            data?.data?.usage !== undefined &&
            data?.data?.usage !== null
              ? data.data.limit - data.data.usage
              : undefined,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('timed out')) {
        throw new ValidationTimeoutError(provider);
      }
      throw error;
    }
  }

  /**
   * Validate OpenAI API key
   * Uses the /models endpoint which is a lightweight read-only call
   */
  private async validateOpenAIKey(apiKey: string): Promise<KeyValidationResult> {
    const provider = AIProvider.OpenAI;

    try {
      // OpenAI doesn't have a dedicated auth check endpoint
      // Use /models which is lightweight and read-only
      const response = await withTimeout(
        signal =>
          fetch('https://api.openai.com/v1/models', {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
            signal,
          }),
        VALIDATION_TIMEOUTS.API_KEY_VALIDATION,
        'OpenAI key validation'
      );

      if (response.status === 401) {
        throw new InvalidApiKeyError(provider, 'Key rejected by OpenAI (401 Unauthorized)');
      }

      if (response.status === 429) {
        // Rate limited could mean quota exceeded or too many requests
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        const message = errorData?.error?.message ?? 'Rate limited';

        if (message.toLowerCase().includes('quota') || message.toLowerCase().includes('billing')) {
          throw new QuotaExceededError(provider, message);
        }

        // Temporary rate limit - key is still valid
        logger.warn(
          { message },
          '[KeyValidationService] OpenAI rate limited but key appears valid'
        );
        return { valid: true, provider };
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new InvalidApiKeyError(provider, `HTTP ${response.status}: ${errorText}`);
      }

      logger.info('[KeyValidationService] OpenAI key validated successfully');

      return {
        valid: true,
        provider,
        metadata: {
          modelsAvailable: true,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('timed out')) {
        throw new ValidationTimeoutError(provider);
      }
      throw error;
    }
  }
}
