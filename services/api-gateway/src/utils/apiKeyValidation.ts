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

import { createLogger, AIProvider, AI_ENDPOINTS, VALIDATION_TIMEOUTS } from '@tzurot/common-types';

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

    const data = (await response.json()) as { data?: { limit_remaining?: number | null } };
    const credits = data.data?.limit_remaining;

    // Check if quota is available
    // Note: null means unlimited (no limit set), only reject if explicitly 0 or negative
    // Using typeof check because null <= 0 is true in JavaScript (coercion quirk)
    if (typeof credits === 'number' && credits <= 0) {
      return {
        valid: false,
        errorCode: 'QUOTA_EXCEEDED',
        error: 'API key has no remaining credits',
        credits,
      };
    }

    // Only include credits if it's a number (null means unlimited)
    return { valid: true, credits: typeof credits === 'number' ? credits : undefined };
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
 * Validate an ElevenLabs API key
 *
 * Uses the /v1/user endpoint to check:
 * - Key validity (401 = invalid)
 * - Subscription info (character_count, character_limit)
 *
 * Note: Intentionally duplicates validation logic from
 * ai-worker's KeyValidationService.validateElevenLabsKey().
 * Gateway validates on key submission (user-facing flow);
 * worker validates on job execution (runtime health check).
 * Different service boundaries, different error handling.
 */
export async function validateElevenLabsKey(apiKey: string): Promise<ApiKeyValidationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUTS.API_KEY_VALIDATION);

  try {
    const response = await fetch(`${AI_ENDPOINTS.ELEVENLABS_BASE_URL}/user`, {
      method: 'GET',
      headers: {
        'xi-api-key': apiKey,
      },
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      return { valid: false, errorCode: 'INVALID_KEY', error: 'Invalid API key' };
    }

    if (!response.ok) {
      return { valid: false, errorCode: 'UNKNOWN', error: `HTTP ${response.status}` };
    }

    const data = (await response.json()) as {
      subscription?: {
        character_count?: number;
        character_limit?: number;
      };
    };

    const used = data.subscription?.character_count;
    const limit = data.subscription?.character_limit;

    // Check remaining character quota
    if (typeof used === 'number' && typeof limit === 'number' && used >= limit) {
      return {
        valid: false,
        errorCode: 'QUOTA_EXCEEDED',
        error: 'ElevenLabs character quota exhausted',
        credits: limit - used,
      };
    }

    const remaining =
      typeof used === 'number' && typeof limit === 'number' ? limit - used : undefined;

    return { valid: true, credits: remaining };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { valid: false, errorCode: 'TIMEOUT', error: 'Validation request timed out' };
    }

    return {
      valid: false,
      errorCode: 'UNKNOWN',
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Validate an API key for any supported provider
 *
 * @param apiKey - The API key to validate
 * @param provider - The AI provider (openrouter, etc.)
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
    case AIProvider.ElevenLabs:
      return validateElevenLabsKey(apiKey);
    default: {
      const _exhaustive: never = provider;
      return {
        valid: false,
        errorCode: 'UNKNOWN',
        error: `Unsupported provider: ${String(_exhaustive)}`,
      };
    }
  }
}
