/**
 * Validated Mock Factories
 *
 * These factories create mock data that is VALIDATED against Zod schemas.
 * If a test tries to mock an invalid shape, it will CRASH immediately.
 *
 * Usage:
 *   import { mockSetOverrideResponse } from '@tzurot/common-types/factories';
 *
 * IMPORTANT: Always use these factories instead of manually constructing
 * mock objects. This ensures your mocks match the actual API contracts.
 */

// Persona endpoint mocks
export * from './persona.js';

// Personality endpoint mocks
export * from './personality.js';

// Model Override endpoint mocks
export * from './model-override.js';

// Wallet endpoint mocks
export * from './wallet.js';

// Timezone endpoint mocks
export * from './timezone.js';

// LLM Config endpoint mocks
export * from './llm-config.js';
