/**
 * Zod schemas for /user/personality API endpoints
 *
 * These schemas define the contract between api-gateway and bot-client.
 * BOTH services should import these to ensure type safety.
 */

import { z } from 'zod';

// ============================================================================
// Shared Sub-schemas
// ============================================================================

/** Full personality data for dashboard/editing */
export const PersonalityFullSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  displayName: z.string().nullable(),
  characterInfo: z.string().nullable(),
  personalityTraits: z.string().nullable(),
  personalityTone: z.string().nullable(),
  personalityAge: z.string().nullable(),
  personalityAppearance: z.string().nullable(),
  personalityLikes: z.string().nullable(),
  personalityDislikes: z.string().nullable(),
  conversationalGoals: z.string().nullable(),
  conversationalExamples: z.string().nullable(),
  errorMessage: z.string().nullable(),
  birthMonth: z.number().nullable(),
  birthDay: z.number().nullable(),
  birthYear: z.number().nullable(),
  isPublic: z.boolean(),
  voiceEnabled: z.boolean(),
  imageEnabled: z.boolean(),
  ownerId: z.string(),
  hasAvatar: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PersonalityFull = z.infer<typeof PersonalityFullSchema>;

// ============================================================================
// POST /user/personality
// Creates a new personality (character)
// ============================================================================

export const CreatePersonalityResponseSchema = z.object({
  success: z.literal(true),
  personality: PersonalityFullSchema,
});
export type CreatePersonalityResponse = z.infer<typeof CreatePersonalityResponseSchema>;

// ============================================================================
// PUT /user/personality/:slug
// Updates an existing personality
// ============================================================================

export const UpdatePersonalityResponseSchema = z.object({
  success: z.literal(true),
  personality: PersonalityFullSchema.pick({
    id: true,
    name: true,
    slug: true,
    displayName: true,
    isPublic: true,
    updatedAt: true,
  }),
});
export type UpdatePersonalityResponse = z.infer<typeof UpdatePersonalityResponseSchema>;

// ============================================================================
// GET /user/personality/:slug
// Gets a single personality by slug
// ============================================================================

export const GetPersonalityResponseSchema = z.object({
  personality: PersonalityFullSchema,
});
export type GetPersonalityResponse = z.infer<typeof GetPersonalityResponseSchema>;

// ============================================================================
// GET /user/personality
// Lists all personalities owned by user
// ============================================================================

export const ListPersonalitiesResponseSchema = z.object({
  personalities: z.array(
    PersonalityFullSchema.pick({
      id: true,
      name: true,
      slug: true,
      displayName: true,
      isPublic: true,
      hasAvatar: true,
    })
  ),
});
export type ListPersonalitiesResponse = z.infer<typeof ListPersonalitiesResponseSchema>;
