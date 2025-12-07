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
