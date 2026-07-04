/**
 * OpenRouter API key validation.
 *
 * Uses the `/auth/key` introspection endpoint to check key validity AND
 * remaining credit balance. OpenRouter returns `null` for `limit_remaining`
 * when no quota is configured (treated as "unlimited"); only an explicit
 * `<= 0` is rejected as quota-exhausted.
 */

import { VALIDATION_TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { VALIDATION_MESSAGES, type ApiKeyValidationResult } from './types.js';

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

    if (response.status === 401 || response.status === 403) {
      return { valid: false, errorCode: 'INVALID_KEY', error: VALIDATION_MESSAGES.INVALID_KEY };
    }

    if (!response.ok) {
      return { valid: false, errorCode: 'UNKNOWN', error: `HTTP ${response.status}` };
    }

    const data = (await response.json()) as { data?: { limit_remaining?: number | null } };
    const credits = data.data?.limit_remaining;

    // null means unlimited (no quota); only reject when explicitly 0 or negative.
    // typeof check guards the JS coercion `null <= 0 === true` quirk.
    if (typeof credits === 'number' && credits <= 0) {
      return {
        valid: false,
        errorCode: 'QUOTA_EXCEEDED',
        error: 'API key has no remaining credits',
        credits,
      };
    }

    return { valid: true, credits: typeof credits === 'number' ? credits : undefined };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { valid: false, errorCode: 'TIMEOUT', error: VALIDATION_MESSAGES.TIMEOUT };
    }

    return {
      valid: false,
      errorCode: 'UNKNOWN',
      error: error instanceof Error ? error.message : VALIDATION_MESSAGES.FALLBACK,
    };
  } finally {
    clearTimeout(timeout);
  }
}
