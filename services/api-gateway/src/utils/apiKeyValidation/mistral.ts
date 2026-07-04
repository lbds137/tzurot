/**
 * Mistral API key validation.
 *
 * Uses `GET /v1/models` to probe — auth-only, no body, no cost. The same
 * key authorizes the entire `/v1/*` namespace (chat, audio, embeddings),
 * so a successful `models` lookup means the key works for the audio
 * endpoints we actually use. Mistral doesn't expose a quota field on the
 * models endpoint; surfaced quota errors will arrive at first synthesis
 * call (auth shape is the only thing we validate up-front here).
 *
 * Mirrors `validateElevenLabsKey` in shape, with the audio quota check
 * dropped (no analog).
 */

import { AI_ENDPOINTS } from '@tzurot/common-types/constants/ai';
import { VALIDATION_TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { VALIDATION_MESSAGES, type ApiKeyValidationResult } from './types.js';

export async function validateMistralKey(apiKey: string): Promise<ApiKeyValidationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUTS.API_KEY_VALIDATION);

  try {
    const response = await fetch(`${AI_ENDPOINTS.MISTRAL_BASE_URL}/models`, {
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
