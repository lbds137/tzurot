/**
 * API Key Validation Dispatcher
 *
 * Per-provider validators live in `./apiKeyValidation/{provider}.ts`. This
 * file is the public entry point: it dispatches `validateApiKey(key, provider)`
 * to the right provider-specific validator and re-exports the public result
 * types so callers don't need to know the directory layout.
 *
 * Security:
 * - Keys are validated with the provider before storage
 * - Never logs or returns the actual API key
 * - Each per-provider validator handles its own timeout
 *
 * Adding a new provider:
 * 1. Add a `apiKeyValidation/<provider>.ts` file with a `validate<Provider>Key`
 *    function that returns `ApiKeyValidationResult`.
 * 2. Add a case to the switch below.
 * 3. Add a `<provider>.test.ts` file colocated with the validator.
 */

import { AIProvider } from '@tzurot/common-types/constants/ai';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { validateOpenRouterKey } from './apiKeyValidation/openrouter.js';
import { validateElevenLabsKey } from './apiKeyValidation/elevenlabs.js';
import { validateMistralKey } from './apiKeyValidation/mistral.js';
import { validateZaiCodingKey } from './apiKeyValidation/zaiCoding.js';
import type { ApiKeyValidationResult } from './apiKeyValidation/types.js';

const logger = createLogger('api-key-validation');

// Re-export public types so callers (wallet routes, tests) don't need to
// reach into the per-provider directory. Per-provider functions stay
// internal — only the dispatcher is part of this module's surface.
export type { ApiKeyValidationResult, ValidationErrorCode } from './apiKeyValidation/types.js';
// Per-provider validators are also exported for tests that exercise a single
// provider in isolation. Application code should use `validateApiKey` instead.
export { validateOpenRouterKey } from './apiKeyValidation/openrouter.js';
export { validateElevenLabsKey } from './apiKeyValidation/elevenlabs.js';
export { validateMistralKey } from './apiKeyValidation/mistral.js';
export { validateZaiCodingKey } from './apiKeyValidation/zaiCoding.js';

/**
 * Validate an API key for any supported provider.
 *
 * @param apiKey - The API key to validate
 * @param provider - The AI provider (openrouter, elevenlabs, mistral, zai)
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
    case AIProvider.Mistral:
      return validateMistralKey(apiKey);
    case AIProvider.ZaiCoding:
      return validateZaiCodingKey(apiKey);
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
