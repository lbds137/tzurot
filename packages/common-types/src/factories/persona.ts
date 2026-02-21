/* eslint-disable sonarjs/no-duplicate-string -- Test factory with intentional field repetition (UUIDs, names) for readable mock data */
/**
 * Validated Mock Factories for Persona API Responses
 *
 * These factories create mock data that is VALIDATED against the Zod schemas.
 * If a test tries to mock an invalid shape, it will CRASH immediately.
 *
 * Usage in tests:
 *   import { mockSetOverrideResponse } from '@tzurot/common-types/factories';
 *
 *   mockCallGatewayApi.mockResolvedValue({
 *     ok: true,
 *     data: mockSetOverrideResponse({ persona: { name: 'Custom Name' } }),
 *   });
 */

import {
  ListPersonasResponseSchema,
  GetPersonaResponseSchema,
  CreatePersonaResponseSchema,
  SetDefaultPersonaResponseSchema,
  UpdatePersonaSettingsResponseSchema,
  OverrideInfoResponseSchema,
  SetOverrideResponseSchema,
  ClearOverrideResponseSchema,
  CreateOverrideResponseSchema,
  type ListPersonasResponse,
  type GetPersonaResponse,
  type CreatePersonaResponse,
  type SetDefaultPersonaResponse,
  type UpdatePersonaSettingsResponse,
  type OverrideInfoResponse,
  type SetOverrideResponse,
  type ClearOverrideResponse,
  type CreateOverrideResponse,
  type PersonaDetails,
  type PersonaSummary,
} from '../schemas/api/persona.js';

// Default UUIDs for consistent test data (RFC 4122 compliant v5 UUIDs)
const DEFAULT_PERSONALITY_ID = '11111111-1111-5111-8111-111111111111';
const DEFAULT_PERSONA_ID = '22222222-2222-5222-8222-222222222222';

import { type DeepPartial, deepMerge } from './factoryUtils.js';

// ============================================================================
// Helper Functions
// ============================================================================

/** Create a base persona details object */
function createBasePersonaDetails(overrides?: DeepPartial<PersonaDetails>): PersonaDetails {
  const now = new Date().toISOString();
  const base: PersonaDetails = {
    id: DEFAULT_PERSONA_ID,
    name: 'TestPersona',
    preferredName: 'Tester',
    description: 'Test description',
    pronouns: 'they/them',
    content: 'Test content',
    isDefault: false,
    shareLtmAcrossPersonalities: false,
    createdAt: now,
    updatedAt: now,
  };
  return deepMerge(base, overrides);
}

/** Create a base persona summary object */
function createBasePersonaSummary(overrides?: DeepPartial<PersonaSummary>): PersonaSummary {
  const now = new Date().toISOString();
  const base: PersonaSummary = {
    id: DEFAULT_PERSONA_ID,
    name: 'TestPersona',
    preferredName: 'Tester',
    description: 'Test description',
    pronouns: 'they/them',
    content: 'Test content',
    isDefault: false,
    shareLtmAcrossPersonalities: false,
    createdAt: now,
    updatedAt: now,
  };
  return deepMerge(base, overrides);
}

// ============================================================================
// List Personas (GET /user/persona)
// ============================================================================

/**
 * Create a validated mock for GET /user/persona
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockListPersonasResponse(
  personas?: DeepPartial<PersonaSummary>[]
): ListPersonasResponse {
  const defaultList = [createBasePersonaSummary()];

  return ListPersonasResponseSchema.parse({
    personas: personas?.map(p => createBasePersonaSummary(p)) ?? defaultList,
  });
}

// ============================================================================
// Get Persona (GET /user/persona/:id)
// ============================================================================

/**
 * Create a validated mock for GET /user/persona/:id
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockGetPersonaResponse(
  overrides?: DeepPartial<GetPersonaResponse>
): GetPersonaResponse {
  const base: GetPersonaResponse = {
    persona: createBasePersonaDetails(),
  };
  return GetPersonaResponseSchema.parse(deepMerge(base, overrides));
}

// ============================================================================
// Create Persona (POST /user/persona)
// ============================================================================

/**
 * Create a validated mock for POST /user/persona
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockCreatePersonaResponse(
  overrides?: DeepPartial<CreatePersonaResponse>
): CreatePersonaResponse {
  const base: CreatePersonaResponse = {
    success: true,
    persona: createBasePersonaDetails(),
    setAsDefault: false,
  };
  return CreatePersonaResponseSchema.parse(deepMerge(base, overrides));
}

// ============================================================================
// Set Default Persona (PATCH /user/persona/:id/default)
// ============================================================================

/**
 * Create a validated mock for PATCH /user/persona/:id/default
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockSetDefaultPersonaResponse(
  overrides?: DeepPartial<SetDefaultPersonaResponse>
): SetDefaultPersonaResponse {
  const base: SetDefaultPersonaResponse = {
    success: true,
    persona: {
      id: DEFAULT_PERSONA_ID,
      name: 'TestPersona',
      preferredName: 'Tester',
    },
    alreadyDefault: false,
  };
  return SetDefaultPersonaResponseSchema.parse(deepMerge(base, overrides));
}

// ============================================================================
// Update Settings (PATCH /user/persona/settings)
// ============================================================================

/**
 * Create a validated mock for PATCH /user/persona/settings
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockUpdatePersonaSettingsResponse(
  overrides?: DeepPartial<UpdatePersonaSettingsResponse>
): UpdatePersonaSettingsResponse {
  const base: UpdatePersonaSettingsResponse = {
    success: true,
    unchanged: false,
  };
  return UpdatePersonaSettingsResponseSchema.parse(deepMerge(base, overrides));
}

// ============================================================================
// Override Info (GET /user/persona/override/:slug)
// ============================================================================

/**
 * Create a validated mock for GET /user/persona/override/:slug
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockOverrideInfoResponse(
  overrides?: DeepPartial<OverrideInfoResponse>
): OverrideInfoResponse {
  const base: OverrideInfoResponse = {
    personality: {
      id: DEFAULT_PERSONALITY_ID,
      name: 'TestPersonality',
      displayName: 'Test Personality',
    },
  };
  return OverrideInfoResponseSchema.parse(deepMerge(base, overrides));
}

// ============================================================================
// Set Override (PUT /user/persona/override/:slug)
// ============================================================================

/**
 * Create a validated mock for PUT /user/persona/override/:slug
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockSetOverrideResponse(
  overrides?: DeepPartial<SetOverrideResponse>
): SetOverrideResponse {
  const base: SetOverrideResponse = {
    success: true,
    personality: {
      id: DEFAULT_PERSONALITY_ID,
      name: 'TestPersonality',
      displayName: 'Test Personality',
    },
    persona: {
      id: DEFAULT_PERSONA_ID,
      name: 'TestPersona',
      preferredName: 'Tester',
    },
  };
  return SetOverrideResponseSchema.parse(deepMerge(base, overrides));
}

// ============================================================================
// Clear Override (DELETE /user/persona/override/:slug)
// ============================================================================

/**
 * Create a validated mock for DELETE /user/persona/override/:slug
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockClearOverrideResponse(
  overrides?: DeepPartial<ClearOverrideResponse>
): ClearOverrideResponse {
  const base: ClearOverrideResponse = {
    success: true,
    personality: {
      id: DEFAULT_PERSONALITY_ID,
      name: 'TestPersonality',
      displayName: 'Test Personality',
    },
    hadOverride: true,
  };
  return ClearOverrideResponseSchema.parse(deepMerge(base, overrides));
}

// ============================================================================
// Create Override (POST /user/persona/override/by-id/:id)
// ============================================================================

/**
 * Create a validated mock for POST /user/persona/override/by-id/:id
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockCreateOverrideResponse(
  overrides?: DeepPartial<CreateOverrideResponse>
): CreateOverrideResponse {
  const base: CreateOverrideResponse = {
    success: true,
    persona: {
      id: DEFAULT_PERSONA_ID,
      name: 'NewPersona',
      preferredName: 'Tester',
      description: 'Test description',
      pronouns: 'they/them',
      content: 'Test content',
    },
    personality: {
      name: 'TestPersonality',
      displayName: 'Test Personality',
    },
  };
  return CreateOverrideResponseSchema.parse(deepMerge(base, overrides));
}
