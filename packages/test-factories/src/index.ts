/**
 * Validated Mock Factories
 *
 * These factories create mock data that is VALIDATED against Zod schemas.
 * If a test tries to mock an invalid shape, it will CRASH immediately.
 *
 * Usage:
 *   import { mockSetOverrideResponse } from '@tzurot/test-factories';
 *
 * IMPORTANT: Always use these factories instead of manually constructing
 * mock objects. This ensures your mocks match the actual API contracts.
 */

// Shared factory utilities
export { type DeepPartial, deepMerge } from './factoryUtils.js';

// Persona endpoint mocks
export {
  mockClearOverrideResponse,
  mockCreateOverrideResponse,
  mockCreatePersonaResponse,
  mockGetPersonaResponse,
  mockListPersonasResponse,
  mockOverrideInfoResponse,
  mockSetDefaultPersonaResponse,
  mockSetOverrideResponse,
} from './persona.js';

// Personality endpoint mocks
export {
  mockCreatePersonalityResponse,
  mockGetPersonalityResponse,
  mockListPersonalitiesResponse,
} from './personality.js';

// Model Override endpoint mocks
export {
  mockClearDefaultConfigResponse,
  mockDeleteModelOverrideResponse,
  mockListModelOverridesResponse,
  mockSetDefaultConfigResponse,
  mockSetModelOverrideResponse,
} from './model-override.js';

// Wallet endpoint mocks
export {
  mockListWalletKeysResponse,
  mockRemoveWalletKeyResponse,
  mockTestWalletKeyResponse,
} from './wallet.js';

// Timezone endpoint mocks
export { mockGetTimezoneResponse, mockSetTimezoneResponse } from './timezone.js';

// LLM Config endpoint mocks
export {
  mockCreateLlmConfigResponse,
  mockDeleteLlmConfigResponse,
  mockListLlmConfigsResponse,
  mockLlmConfigDetail,
  mockLlmConfigSummary,
} from './llm-config.js';

// TTS Override endpoint mocks
export { mockClearTtsDefaultConfigResponse } from './tts-override.js';
