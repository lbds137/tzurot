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

// ============================================================================
// Shared Sub-schemas (reusable across endpoints)
// ============================================================================

/** Reference to a personality (minimal data for display) */
export const PersonalityRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  displayName: z.string().nullable(),
});
export type PersonalityRef = z.infer<typeof PersonalityRefSchema>;

/** Reference to a persona (minimal data for display) */
export const PersonaRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  preferredName: z.string().nullable(),
});
export type PersonaRef = z.infer<typeof PersonaRefSchema>;

/** Full persona data (for detailed views) */
export const PersonaFullSchema = PersonaRefSchema.extend({
  description: z.string().nullable(),
  pronouns: z.string().nullable(),
  content: z.string().nullable(),
});
export type PersonaFull = z.infer<typeof PersonaFullSchema>;

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
  personalityName: z.string(),
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
// POST /user/persona
// Creates a new persona
// ============================================================================

export const CreatePersonaResponseSchema = z.object({
  persona: PersonaFullSchema.extend({
    isDefault: z.boolean(),
    createdAt: z.string().datetime(),
  }),
});
export type CreatePersonaResponse = z.infer<typeof CreatePersonaResponseSchema>;

// ============================================================================
// PUT /user/persona/:id
// Updates an existing persona
// ============================================================================

export const UpdatePersonaResponseSchema = z.object({
  persona: PersonaFullSchema.extend({
    isDefault: z.boolean(),
    updatedAt: z.string().datetime(),
  }),
});
export type UpdatePersonaResponse = z.infer<typeof UpdatePersonaResponseSchema>;

// ============================================================================
// PATCH /user/persona/:id/default
// Sets a persona as the user's default
// ============================================================================

export const SetDefaultPersonaResponseSchema = z.object({
  success: z.literal(true),
  persona: PersonaRefSchema.extend({
    isDefault: z.literal(true),
  }),
});
export type SetDefaultPersonaResponse = z.infer<typeof SetDefaultPersonaResponseSchema>;
