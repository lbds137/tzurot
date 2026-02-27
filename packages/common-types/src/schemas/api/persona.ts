/**
 * Zod schemas for /user/persona API endpoints
 *
 * These schemas define the contract between api-gateway and bot-client.
 * BOTH services should import these to ensure type safety.
 *
 * Usage:
 * - Gateway: Use schema.parse(response) before sending
 * - Bot-client tests: Use factories from @tzurot/common-types/factories
 */

import { z } from 'zod';

import { DISCORD_LIMITS } from '../../constants/discord.js';
import { nullableString, optionalString } from './shared.js';

// ============================================================================
// Shared Sub-schemas (reusable across endpoints)
// ============================================================================

/** Reference to a personality (minimal data for display) */
const PersonalityRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  displayName: z.string().nullable(),
});

/** Reference to a persona (minimal data for display) */
const PersonaRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  preferredName: z.string().nullable(),
});

/** Full persona data (for detailed views) */
const PersonaFullSchema = PersonaRefSchema.extend({
  description: z.string().nullable(),
  pronouns: z.string().nullable(),
  content: z.string().nullable(),
});

/** Persona details (full data with metadata) */
export const PersonaDetailsSchema = PersonaFullSchema.extend({
  isDefault: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PersonaDetails = z.infer<typeof PersonaDetailsSchema>;

/** Persona summary for lists (subset of PersonaDetails) */
export const PersonaSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  preferredName: z.string().nullable(),
  description: z.string().nullable(),
  pronouns: z.string().nullable(),
  content: z.string().nullable(),
  isDefault: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PersonaSummary = z.infer<typeof PersonaSummarySchema>;

// ============================================================================
// GET /user/persona
// Returns list of user's personas
// ============================================================================

export const ListPersonasResponseSchema = z.object({
  personas: z.array(PersonaSummarySchema),
});
export type ListPersonasResponse = z.infer<typeof ListPersonasResponseSchema>;

// ============================================================================
// GET /user/persona/:id
// Returns a specific persona by ID
// ============================================================================

export const GetPersonaResponseSchema = z.object({
  persona: PersonaDetailsSchema,
});
export type GetPersonaResponse = z.infer<typeof GetPersonaResponseSchema>;

// ============================================================================
// POST /user/persona
// Creates a new persona
// ============================================================================

export const CreatePersonaResponseSchema = z.object({
  success: z.literal(true),
  persona: PersonaDetailsSchema,
  setAsDefault: z.boolean(),
});
export type CreatePersonaResponse = z.infer<typeof CreatePersonaResponseSchema>;

// ============================================================================
// PATCH /user/persona/:id/default
// Sets a persona as the user's default
// ============================================================================

export const SetDefaultPersonaResponseSchema = z.object({
  success: z.literal(true),
  persona: PersonaRefSchema,
  alreadyDefault: z.boolean(),
});
export type SetDefaultPersonaResponse = z.infer<typeof SetDefaultPersonaResponseSchema>;

// ============================================================================
// GET /user/persona/override/:personalitySlug
// Returns personality info for override modal preparation
// ============================================================================

export const OverrideInfoResponseSchema = z.object({
  personality: PersonalityRefSchema,
});
export type OverrideInfoResponse = z.infer<typeof OverrideInfoResponseSchema>;

// ============================================================================
// PUT /user/persona/override/:personalitySlug
// Sets an existing persona as override for a personality
// ============================================================================

export const SetOverrideResponseSchema = z.object({
  success: z.literal(true),
  personality: PersonalityRefSchema,
  persona: PersonaRefSchema,
});
export type SetOverrideResponse = z.infer<typeof SetOverrideResponseSchema>;

// ============================================================================
// DELETE /user/persona/override/:personalitySlug
// Clears a persona override for a personality
// ============================================================================

export const ClearOverrideResponseSchema = z.object({
  success: z.literal(true),
  personality: PersonalityRefSchema,
  hadOverride: z.boolean(),
});
export type ClearOverrideResponse = z.infer<typeof ClearOverrideResponseSchema>;

// ============================================================================
// POST /user/persona/override/by-id/:personalityId
// Creates a new persona and sets it as override
// ============================================================================

export const CreateOverrideResponseSchema = z.object({
  success: z.literal(true),
  persona: PersonaFullSchema,
  personality: z.object({
    name: z.string(),
    displayName: z.string().nullable(),
  }),
});
export type CreateOverrideResponse = z.infer<typeof CreateOverrideResponseSchema>;

// ============================================================================
// Input Schemas (request body validation)
// ============================================================================

/**
 * Schema for creating a new persona.
 * - name: Required, non-empty string
 * - content: Required, non-empty string with max length
 * - preferredName, description, pronouns: Optional nullable strings
 */
export const PersonaCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  content: z
    .string()
    .min(1, 'Content is required')
    .max(
      DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH,
      `Content must be ${DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH} characters or less`
    ),
  preferredName: nullableString(255),
  description: nullableString(500),
  pronouns: nullableString(100),
});
export type PersonaCreateInput = z.infer<typeof PersonaCreateSchema>;

/**
 * Schema for updating a persona.
 * Uses empty-to-undefined/null transforms so clients can send "" to preserve or clear fields.
 * - name, content: Empty string → undefined (preserve existing value)
 * - preferredName, description, pronouns: Empty string → null (clear the value)
 */
export const PersonaUpdateSchema = z.object({
  name: optionalString(255),
  content: optionalString(DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH),
  preferredName: nullableString(255),
  description: nullableString(500),
  pronouns: nullableString(100),
});
export type PersonaUpdateInput = z.infer<typeof PersonaUpdateSchema>;

/**
 * Schema for setting a persona override on a personality.
 */
export const SetPersonaOverrideSchema = z.object({
  personaId: z.string().uuid('Invalid persona ID format'),
});
export type SetPersonaOverrideInput = z.infer<typeof SetPersonaOverrideSchema>;

// ============================================================================
// Database Constants
// ============================================================================

/** Standard Prisma SELECT for persona queries */
export const PERSONA_SELECT = {
  id: true,
  name: true,
  preferredName: true,
  description: true,
  content: true,
  pronouns: true,
  createdAt: true,
  updatedAt: true,
} as const;
