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

import {
  createLogger,
  AIProvider,
  AI_ENDPOINTS,
  VALIDATION_TIMEOUTS,
  TimeoutError,
  ZAI_VALIDATION_MODEL,
} from '@tzurot/common-types';
import { withTimeout } from '../utils/retry.js';

const logger = createLogger('KeyValidationService');

/** Fallback error text when an HTTP error response body cannot be parsed. */
const UNKNOWN_ERROR_TEXT = 'Unknown error';

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
 * Error thrown when the upstream provider returns a 5xx response during
 * validation. Distinct from `InvalidApiKeyError` — a 5xx means "key may be
 * fine, provider is having issues", not "key is bad". Callers that classify
 * validation failures (retry vs. surface to user) should treat this as
 * transient.
 */
export class ProviderUnavailableError extends Error {
  constructor(
    public readonly provider: AIProvider,
    public readonly httpStatus: number,
    public readonly responseBody?: string
  ) {
    super(`Provider ${provider} returned HTTP ${httpStatus} during validation`);
    this.name = 'ProviderUnavailableError';
  }
}

/**
 * Result of API key validation
 */
interface KeyValidationResult {
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

/** OpenRouter API key info response shape */
interface OpenRouterKeyData {
  label?: string;
  usage?: number;
  limit?: number;
  is_free_tier?: boolean;
  rate_limit?: { requests?: number; interval?: string };
}

/**
 * Handle HTTP error status codes from OpenRouter
 * @throws InvalidApiKeyError or QuotaExceededError for known error codes
 */
async function handleOpenRouterHttpError(response: Response): Promise<void> {
  const provider = AIProvider.OpenRouter;

  if (response.status === 401) {
    throw new InvalidApiKeyError(provider, 'Key rejected by OpenRouter (401 Unauthorized)');
  }
  if (response.status === 402) {
    throw new QuotaExceededError(provider, 'No credits remaining');
  }
  if (response.status === 429) {
    throw new QuotaExceededError(provider, 'Rate limited - try again later');
  }
  // 5xx means "OpenRouter is having issues," not "key is bad." Mirrors the
  // classification applied to validateElevenLabsKey + validateZaiCodingKey so
  // callers see consistent transient-vs-terminal classification across all
  // three validators. During an OpenRouter outage, a valid key no longer gets
  // flagged as invalid in the runtime health check.
  if (response.status >= 500) {
    const errorText = await response.text().catch(() => UNKNOWN_ERROR_TEXT);
    throw new ProviderUnavailableError(provider, response.status, errorText);
  }
  if (!response.ok) {
    const errorText = await response.text().catch(() => UNKNOWN_ERROR_TEXT);
    throw new InvalidApiKeyError(provider, `HTTP ${response.status}: ${errorText}`);
  }
}

/**
 * Calculate credit balance from OpenRouter key data
 */
function calculateCreditBalance(data?: OpenRouterKeyData): number | undefined {
  if (data?.limit === undefined || data?.limit === null) {
    return undefined;
  }
  if (data?.usage === undefined || data?.usage === null) {
    return undefined;
  }
  return data.limit - data.usage;
}

/**
 * Key Validation Service
 * Validates API keys by making dry-run calls to providers
 */
export class KeyValidationService {
  /**
   * Validate an API key for a specific provider.
   *
   * Makes a lightweight API call to the provider to verify the key is valid
   * and has available quota/credits. This is a dry-run validation that
   * doesn't consume significant resources.
   *
   * @param apiKey - The API key to validate (never logged)
   * @param provider - The AI provider (openrouter, openai, etc.)
   * @returns Validation result with success/failure details and optional metadata
   *
   * @throws Never throws - all errors are caught and returned in the result
   *
   * @example
   * ```typescript
   * const service = new KeyValidationService();
   * const result = await service.validateKey('sk-or-v1-...', AIProvider.OpenRouter);
   *
   * if (result.valid) {
   *   console.log('Key is valid, credits:', result.metadata?.creditBalance);
   * } else {
   *   console.error('Validation failed:', result.error?.message);
   * }
   * ```
   *
   * @remarks
   * - OpenRouter: Uses /auth/key endpoint, returns credit balance
   * - OpenAI: Uses /models endpoint (lightweight read-only call)
   * - Unsupported providers: Returns valid=true (optimistic validation)
   *
   * @see {@link InvalidApiKeyError} - Thrown when key is rejected by provider
   * @see {@link QuotaExceededError} - Thrown when credits/quota exhausted
   * @see {@link ValidationTimeoutError} - Thrown when validation request times out
   */
  async validateKey(apiKey: string, provider: AIProvider): Promise<KeyValidationResult> {
    logger.info({ provider }, 'Validating API key');

    try {
      switch (provider) {
        case AIProvider.OpenRouter:
          return await this.validateOpenRouterKey(apiKey);
        case AIProvider.ElevenLabs:
          return await this.validateElevenLabsKey(apiKey);
        case AIProvider.ZaiCoding:
          return await this.validateZaiCodingKey(apiKey);
        case AIProvider.Mistral:
          // Mistral key validation is handled at first-use rather than via
          // a probe endpoint here — the TTS Phase 1 plan doesn't include
          // a key-validation route for Mistral. Optimistic accept; first
          // failed `/v1/audio/speech` call surfaces the auth error.
          // TODO(PR 2): add a `/v1/models` probe similar to validateOpenRouterKey.
          return { valid: true, provider };
        default: {
          const _exhaustive: never = provider;
          logger.warn({ provider: _exhaustive }, 'Unsupported provider for validation');
          // For unsupported providers, return valid=true (optimistic)
          return { valid: true, provider: _exhaustive };
        }
      }
    } catch (error) {
      logger.error({ err: error, provider }, 'Unexpected error during validation');

      if (
        error instanceof InvalidApiKeyError ||
        error instanceof QuotaExceededError ||
        error instanceof ValidationTimeoutError ||
        error instanceof ProviderUnavailableError
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
            headers: { Authorization: `Bearer ${apiKey}` },
            signal,
          }),
        VALIDATION_TIMEOUTS.API_KEY_VALIDATION,
        'OpenRouter key validation'
      );

      await handleOpenRouterHttpError(response);

      const data = (await response.json()) as { data?: OpenRouterKeyData };

      logger.info(
        {
          hasData: !!data?.data,
          isFree: data?.data?.is_free_tier,
          usage: data?.data?.usage,
          limit: data?.data?.limit,
        },
        'OpenRouter key validated successfully'
      );

      return {
        valid: true,
        provider,
        metadata: { creditBalance: calculateCreditBalance(data?.data) },
      };
    } catch (error) {
      if (error instanceof TimeoutError) {
        throw new ValidationTimeoutError(provider);
      }
      throw error;
    }
  }

  /**
   * Validate ElevenLabs API key
   * Uses the /v1/user endpoint to check key validity and subscription status.
   *
   * Note: Similar validation exists in api-gateway's apiKeyValidation.ts
   * (validateElevenLabsKey). Gateway validates on key submission; this
   * validates on job execution. Intentionally separate per service boundary.
   */
  private async validateElevenLabsKey(apiKey: string): Promise<KeyValidationResult> {
    const provider = AIProvider.ElevenLabs;

    try {
      const response = await withTimeout(
        signal =>
          fetch(`${AI_ENDPOINTS.ELEVENLABS_BASE_URL}/user`, {
            method: 'GET',
            headers: { 'xi-api-key': apiKey },
            signal,
          }),
        VALIDATION_TIMEOUTS.API_KEY_VALIDATION,
        'ElevenLabs key validation'
      );

      if (response.status === 401 || response.status === 403) {
        throw new InvalidApiKeyError(provider, 'Key rejected by ElevenLabs');
      }

      // 5xx means "provider is having issues," not "key is bad." Surface as
      // transient so callers can distinguish retry-worthy from terminal.
      if (response.status >= 500) {
        const errorText = await response.text().catch(() => UNKNOWN_ERROR_TEXT);
        throw new ProviderUnavailableError(provider, response.status, errorText);
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => UNKNOWN_ERROR_TEXT);
        throw new InvalidApiKeyError(provider, `HTTP ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as {
        subscription?: {
          character_count?: number;
          character_limit?: number;
        };
      };

      const used = data.subscription?.character_count;
      const limit = data.subscription?.character_limit;

      if (typeof used === 'number' && typeof limit === 'number' && used >= limit) {
        throw new QuotaExceededError(provider, 'Character quota exhausted');
      }

      const remaining =
        typeof used === 'number' && typeof limit === 'number' ? limit - used : undefined;

      logger.info(
        { hasSubscription: !!data.subscription, remaining },
        'ElevenLabs key validated successfully'
      );

      return {
        valid: true,
        provider,
        metadata: { creditBalance: remaining },
      };
    } catch (error) {
      if (error instanceof TimeoutError) {
        throw new ValidationTimeoutError(provider);
      }
      throw error;
    }
  }

  /**
   * Validate a z.ai Coding Plan API key.
   *
   * z.ai does not expose an introspection endpoint, so validation is a minimal
   * `chat/completions` POST (max_tokens=1) against the coding-plan base URL.
   *
   * Note: Similar validation exists in api-gateway's apiKeyValidation.ts
   * (validateZaiCodingKey). Gateway validates on key submission; this
   * validates on job execution. Intentionally separate per service boundary.
   */
  private async validateZaiCodingKey(apiKey: string): Promise<KeyValidationResult> {
    const provider = AIProvider.ZaiCoding;

    try {
      const response = await withTimeout(
        signal =>
          fetch(`${AI_ENDPOINTS.ZAI_CODING_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: ZAI_VALIDATION_MODEL,
              messages: [{ role: 'user', content: 'hi' }],
              max_tokens: 1,
            }),
            signal,
          }),
        VALIDATION_TIMEOUTS.API_KEY_VALIDATION,
        'z.ai coding-plan key validation'
      );

      if (response.status === 401 || response.status === 403) {
        throw new InvalidApiKeyError(provider, 'Key rejected by z.ai');
      }

      if (response.status === 429) {
        throw new QuotaExceededError(provider, 'Coding-plan quota exhausted');
      }

      // 5xx means "provider is having issues," not "key is bad." Surface as
      // transient so callers can distinguish retry-worthy from terminal.
      if (response.status >= 500) {
        const errorText = await response.text().catch(() => UNKNOWN_ERROR_TEXT);
        throw new ProviderUnavailableError(provider, response.status, errorText);
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => UNKNOWN_ERROR_TEXT);
        throw new InvalidApiKeyError(provider, `HTTP ${response.status}: ${errorText}`);
      }

      logger.info({ provider }, 'z.ai coding-plan key validated successfully');
      return { valid: true, provider };
    } catch (error) {
      if (error instanceof TimeoutError) {
        throw new ValidationTimeoutError(provider);
      }
      throw error;
    }
  }
}
