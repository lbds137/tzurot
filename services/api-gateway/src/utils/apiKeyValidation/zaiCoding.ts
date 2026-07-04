/**
 * z.ai Coding Plan API key validation.
 *
 * z.ai does not expose an `/auth/key`-style introspection endpoint, so we
 * validate by issuing a minimal `chat/completions` request (max_tokens=1)
 * against the coding-plan endpoint and observing the HTTP status:
 *
 * - 200 → key valid
 * - 401/403 → invalid key
 * - 429 → quota exceeded for the coding plan period
 * - any other non-2xx → UNKNOWN (with HTTP status surfaced to caller)
 *
 * Cost: ~1 token from the user's coding-plan quota per validation.
 * Validation runs only on key intake (not on every chat request), so the
 * quota impact is negligible.
 */

import { AI_ENDPOINTS, ZAI_VALIDATION_MODEL } from '@tzurot/common-types/constants/ai';
import { VALIDATION_TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { VALIDATION_MESSAGES, type ApiKeyValidationResult } from './types.js';

export async function validateZaiCodingKey(apiKey: string): Promise<ApiKeyValidationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUTS.API_KEY_VALIDATION);

  try {
    const response = await fetch(`${AI_ENDPOINTS.ZAI_CODING_BASE_URL}/chat/completions`, {
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
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      return { valid: false, errorCode: 'INVALID_KEY', error: VALIDATION_MESSAGES.INVALID_KEY };
    }

    if (response.status === 429) {
      return {
        valid: false,
        errorCode: 'QUOTA_EXCEEDED',
        error: VALIDATION_MESSAGES.QUOTA_EXCEEDED_ZAI,
      };
    }

    if (!response.ok) {
      return { valid: false, errorCode: 'UNKNOWN', error: `HTTP ${response.status}` };
    }

    return { valid: true };
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
