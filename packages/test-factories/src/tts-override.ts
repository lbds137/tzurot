/**
 * Validated mock factories for TTS-override API responses. Mirrors
 * `model-override.ts`; produced mocks are parsed through their Zod schemas
 * so stale-shape mocks fail at test time instead of silently passing.
 */

import {
  ClearTtsDefaultConfigResponseSchema,
  type ClearTtsDefaultConfigResponse,
} from '@tzurot/common-types/schemas/api/tts-override';

// ============================================================================
// Clear Default Config (DELETE /user/tts-override/default)
// ============================================================================

/**
 * Create a validated mock for DELETE /user/tts-override/default.
 * Default is `newEffectiveDefault: null` — pass overrides to populate it.
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockClearTtsDefaultConfigResponse(
  overrides: Partial<ClearTtsDefaultConfigResponse> = {}
): ClearTtsDefaultConfigResponse {
  return ClearTtsDefaultConfigResponseSchema.parse({
    deleted: true,
    newEffectiveDefault: null,
    ...overrides,
  });
}
