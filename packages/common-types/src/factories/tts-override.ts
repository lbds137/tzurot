/**
 * Validated Mock Factories for TTS Override API Responses
 *
 * Mirrors `model-override.ts` for the TTS-side endpoints. These factories
 * produce data that's parsed through the Zod schemas, so a test-time mock
 * with a stale shape fails immediately rather than silently passing.
 *
 * Usage in bot-client tests:
 *   import { mockClearTtsDefaultConfigResponse } from '@tzurot/common-types/factories';
 *
 *   mockCallGatewayApi.mockResolvedValue({
 *     ok: true,
 *     data: mockClearTtsDefaultConfigResponse({
 *       newEffectiveDefault: { id: 'free-id', name: 'kyutai-self-hosted' },
 *     }),
 *   });
 */

import {
  ClearTtsDefaultConfigResponseSchema,
  type ClearTtsDefaultConfigResponse,
} from '../schemas/api/tts-override.js';

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
