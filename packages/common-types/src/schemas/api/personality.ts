/**
 * Zod schemas for personality API endpoints (admin and user)
 *
 * These schemas define the contract between api-gateway and bot-client.
 * BOTH services should import these to ensure type safety.
 *
 * Includes:
 * - Input schemas for create/update operations (shared between admin and user)
 * - Response schemas for GET operations
 * - Prisma SELECT constants for consistent field selection
 */

import { z } from 'zod';
import { EntityPermissionsSchema, nullableString } from './shared.js';

// ============================================================================
// Shared Sub-schemas
// ============================================================================

/**
 * Summary of a personality for list endpoints
 * Matches PersonalitySummary type from types/byok.ts
 */
export const PersonalitySummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  displayName: z.string().nullable(),
  slug: z.string(),
  /** True if the requesting user created this personality (truthful attribution) */
  isOwned: z.boolean(),
  /** True if the personality is publicly visible */
  isPublic: z.boolean(),
  /** Owner's internal user ID */
  ownerId: z.string().nullable(),
  /** Owner's Discord user ID (for fetching display name) */
  ownerDiscordId: z.string().nullable(),
  /** Computed permissions for the requesting user */
  permissions: EntityPermissionsSchema,
});
export type PersonalitySummaryDto = z.infer<typeof PersonalitySummarySchema>;

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
// Lists all personalities visible to user (owned + public)
// ============================================================================

export const ListPersonalitiesResponseSchema = z.object({
  personalities: z.array(PersonalitySummarySchema),
});
export type ListPersonalitiesResponse = z.infer<typeof ListPersonalitiesResponseSchema>;

// ============================================================================
// DELETE /user/personality/:slug
// Deletes a personality and all associated data
// ============================================================================

/** Counts of deleted related records for user feedback */
export const DeletedCountsSchema = z.object({
  /** Number of conversation history messages deleted */
  conversationHistory: z.number().int().nonnegative(),
  /** Number of memory entries deleted */
  memories: z.number().int().nonnegative(),
  /** Number of pending memory entries deleted */
  pendingMemories: z.number().int().nonnegative(),
  /** Number of channel settings deleted */
  channelSettings: z.number().int().nonnegative(),
  /** Number of aliases deleted */
  aliases: z.number().int().nonnegative(),
});
export type DeletedCounts = z.infer<typeof DeletedCountsSchema>;

export const DeletePersonalityResponseSchema = z.object({
  success: z.literal(true),
  /** The slug of the deleted personality */
  deletedSlug: z.string(),
  /** The name of the deleted personality (for user-friendly feedback) */
  deletedName: z.string(),
  /** Counts of deleted related records */
  deletedCounts: DeletedCountsSchema,
});
export type DeletePersonalityResponse = z.infer<typeof DeletePersonalityResponseSchema>;

// ============================================================================
// Input Schemas (shared between admin and user endpoints)
// ============================================================================

/**
 * Slug validation pattern: lowercase letters, numbers, hyphens.
 * Must start with a letter, 3-50 characters.
 */
const slugSchema = z
  .string()
  .min(3, 'slug must be at least 3 characters')
  .max(50, 'slug must be 50 characters or less')
  .regex(
    /^[a-z][a-z0-9-]*$/,
    'slug must start with a letter and contain only lowercase letters, numbers, and hyphens'
  );

/**
 * Schema for creating a new personality.
 *
 * This is the unified schema for both admin and user create operations.
 * The difference in behavior (ownerId, isPublic defaults) is handled by the service layer.
 */
export const PersonalityCreateSchema = z.object({
  // Required fields
  name: z.string().min(1, 'name is required').max(100, 'name must be 100 characters or less'),
  slug: slugSchema,
  characterInfo: z.string().min(1, 'characterInfo is required'),
  personalityTraits: z.string().min(1, 'personalityTraits is required'),

  // Optional display name (defaults to name if not provided)
  displayName: nullableString(100),

  // Character definition (all optional)
  personalityTone: nullableString(500),
  personalityAge: nullableString(100),
  personalityAppearance: nullableString(1000),
  personalityLikes: nullableString(500),
  personalityDislikes: nullableString(500),
  conversationalGoals: nullableString(1000),
  conversationalExamples: nullableString(2000),
  errorMessage: nullableString(500),

  // Visibility - defaults to false, can be set to true to make public
  isPublic: z.boolean().optional(),

  // Custom fields (JSONB) - constrained to JSON-serializable primitives
  customFields: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional()
    .nullable(),

  // Avatar data (base64 encoded, processed separately)
  avatarData: z.string().optional(),
});

export type PersonalityCreateInput = z.infer<typeof PersonalityCreateSchema>;

/**
 * Schema for updating an existing personality.
 *
 * All fields are optional - only provided fields are updated.
 * Empty strings are transformed to null for nullable fields.
 */
export const PersonalityUpdateSchema = z.object({
  // Core fields
  name: z.string().min(1).max(100).optional(),
  slug: slugSchema.optional(),
  displayName: nullableString(100),
  characterInfo: z.string().min(1).optional(),
  personalityTraits: z.string().min(1).optional(),

  // Character definition
  personalityTone: nullableString(500),
  personalityAge: nullableString(100),
  personalityAppearance: nullableString(1000),
  personalityLikes: nullableString(500),
  personalityDislikes: nullableString(500),
  conversationalGoals: nullableString(1000),
  conversationalExamples: nullableString(2000),
  errorMessage: nullableString(500),

  // Visibility
  isPublic: z.boolean().optional(),

  // Custom fields (JSONB) - constrained to JSON-serializable primitives
  customFields: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional()
    .nullable(),

  // Avatar data (base64 encoded, processed separately)
  avatarData: z.string().optional(),

  // Extended context settings (deprecated - use LLM config instead)
  extendedContext: z.boolean().optional().nullable(),
  extendedContextMaxMessages: z.number().int().positive().optional().nullable(),
  extendedContextMaxAge: z.number().int().positive().optional().nullable(),
  extendedContextMaxImages: z.number().int().nonnegative().optional().nullable(),
});

export type PersonalityUpdateInput = z.infer<typeof PersonalityUpdateSchema>;

// ============================================================================
// Admin Response Schemas (different format from user routes)
// ============================================================================

/**
 * Admin create/update response - returns subset of fields plus metadata
 */
export const AdminPersonalityResponseSchema = z.object({
  success: z.literal(true),
  personality: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    displayName: z.string().nullable(),
    hasAvatar: z.boolean(),
  }),
  timestamp: z.string().datetime(),
});
export type AdminPersonalityResponse = z.infer<typeof AdminPersonalityResponseSchema>;

// ============================================================================
// Prisma SELECT constants
// ============================================================================

/**
 * Select fields for list queries (summary data).
 * Used when returning arrays of personalities.
 */
export const PERSONALITY_LIST_SELECT = {
  id: true,
  name: true,
  displayName: true,
  slug: true,
  ownerId: true,
  isPublic: true,
  owner: {
    select: {
      discordId: true,
    },
  },
} as const;

/**
 * Select fields for detail queries (includes all editable fields).
 * Used when returning a single personality with full details.
 */
export const PERSONALITY_DETAIL_SELECT = {
  id: true,
  name: true,
  slug: true,
  displayName: true,
  characterInfo: true,
  personalityTraits: true,
  personalityTone: true,
  personalityAge: true,
  personalityAppearance: true,
  personalityLikes: true,
  personalityDislikes: true,
  conversationalGoals: true,
  conversationalExamples: true,
  errorMessage: true,
  birthMonth: true,
  birthDay: true,
  birthYear: true,
  isPublic: true,
  voiceEnabled: true,
  imageEnabled: true,
  extendedContext: true,
  extendedContextMaxMessages: true,
  extendedContextMaxAge: true,
  extendedContextMaxImages: true,
  ownerId: true,
  avatarData: true,
  customFields: true,
  systemPromptId: true,
  voiceSettings: true,
  imageSettings: true,
  createdAt: true,
  updatedAt: true,
} as const;
