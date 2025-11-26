/**
 * API Key Validation Utilities
 *
 * Shared validation logic for API key storage and testing.
 * Used by wallet/setKey.ts and wallet/testKey.ts routes.
 *
 * Security:
 * - Keys are validated with provider before storage
 * - Never logs or returns the actual API key
 * - Timeout protection against slow responses
 */

import { createLogger, AIProvider, VALIDATION_TIMEOUTS } from '@tzurot/common-types';

const logger = createLogger('api-key-validation');

/**
 * Error codes returned from validation
 */
export type ValidationErrorCode = 'INVALID_KEY' | 'QUOTA_EXCEEDED' | 'TIMEOUT' | 'UNKNOWN';

/**
 * Result of API key validation
 */
export interface ApiKeyValidationResult {
  /** Whether the key is valid */
  valid: boolean;
  /** Credit balance (if available from provider) */
  credits?: number;
  /** Error message if validation failed */
  error?: string;
  /** Error classification code */
  errorCode?: ValidationErrorCode;
}

/**
 * Validate an OpenRouter API key
 *
 * Uses the /auth/key endpoint to check:
 * - Key validity (401/403 = invalid)
 * - Credit balance (402 = no credits)
 */
export async function validateOpenRouterKey(apiKey: string): Promise<ApiKeyValidationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUTS.API_KEY_VALIDATION);

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
 *
 * Uses the /models endpoint (lightweight, read-only) to check:
 * - Key validity (401 = invalid)
 * - Rate limit status (429 = may indicate quota issues)
 */
export async function validateOpenAIKey(apiKey: string): Promise<ApiKeyValidationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUTS.API_KEY_VALIDATION);

  try {
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
 * Validate an API key for any supported provider
 *
 * @param apiKey - The API key to validate
 * @param provider - The AI provider (openrouter, openai, etc.)
 * @returns Validation result with status and optional error details
 */
export async function validateApiKey(
  apiKey: string,
  provider: AIProvider
): Promise<ApiKeyValidationResult> {
  logger.debug({ provider }, 'Validating API key');

  switch (provider) {
    case AIProvider.OpenRouter:
      return validateOpenRouterKey(apiKey);
    case AIProvider.OpenAI:
      return validateOpenAIKey(apiKey);
    default:
      return { valid: false, errorCode: 'UNKNOWN', error: `Unsupported provider: ${String(provider)}` };
  }
}
