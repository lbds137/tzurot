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
import { DISCORD_LIMITS } from '../../constants/discord.js';
import { EntityPermissionsSchema, nullableString } from './shared.js';

// ============================================================================
// Shared Sub-schemas
// ============================================================================

/**
 * Summary of a personality for list endpoints
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

export type PersonalitySummary = z.infer<typeof PersonalitySummarySchema>;

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
  /** When false, non-owners see the card fields redacted to null (see definitionRedacted). */
  definitionPublic: z.boolean(),
  /**
   * True when the card fields in THIS response were redacted because the
   * requester can't see the definition (non-owner + definitionPublic=false).
   * Lets the client show a "definition is private" state instead of treating
   * the nulled fields as "creator left them blank."
   */
  definitionRedacted: z.boolean(),
  voiceEnabled: z.boolean(),
  imageEnabled: z.boolean(),
  ownerId: z.string(),
  hasAvatar: z.boolean(),
  hasVoiceReference: z.boolean(),
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
// GET /user/personality/:slug
// Gets a single personality by slug
// ============================================================================

export const GetPersonalityResponseSchema = z.object({
  personality: PersonalityFullSchema,
  // The GET /user/personality/:slug handler computes `canEdit` via
  // `canUserEditPersonality()` (owner OR bot-admin) and always returns it.
  // Required for callers that gate edit-only UI on the requester's permission.
  canEdit: z.boolean(),
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
const DeletedCountsSchema = z.object({
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

export const DeletePersonalityResponseSchema = z.object({
  success: z.literal(true),
  /** The slug of the deleted personality */
  deletedSlug: z.string(),
  /** The name of the deleted personality (for user-friendly feedback) */
  deletedName: z.string(),
  /** Counts of deleted related records */
  deletedCounts: DeletedCountsSchema,
});

// ============================================================================
// Shared Character Definition Fields
// ============================================================================

/**
 * The 8 character definition fields that appear across create/update schemas,
 * API response interfaces, and DB types. Defined once, used everywhere.
 *
 * NOTE: The TypeScript interface uses `string | null` (DB/API representation),
 * while the Zod schema uses `nullableString()` which also accepts `undefined`
 * (for optional update semantics). They serve different purposes.
 */
export interface PersonalityCharacterFields {
  personalityTone: string | null;
  personalityAge: string | null;
  personalityAppearance: string | null;
  personalityLikes: string | null;
  personalityDislikes: string | null;
  conversationalGoals: string | null;
  conversationalExamples: string | null;
  errorMessage: string | null;
}

/**
 * Zod schema fragment for character definition fields.
 * Shared between PersonalityCreateSchema and PersonalityUpdateSchema.
 */
export const PersonalityCharacterFieldsSchema = z.object({
  personalityTone: nullableString(DISCORD_LIMITS.SHORT_PARAGRAPH_MAX_LENGTH),
  personalityAge: nullableString(100),
  personalityAppearance: nullableString(DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH),
  personalityLikes: nullableString(DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH),
  personalityDislikes: nullableString(DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH),
  conversationalGoals: nullableString(DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH),
  conversationalExamples: nullableString(DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH),
  errorMessage: nullableString(DISCORD_LIMITS.SHORT_PARAGRAPH_MAX_LENGTH),
});

// ============================================================================
// Input Schemas (shared between admin and user endpoints)
// ============================================================================

/**
 * Slug validation pattern: lowercase letters, numbers, hyphens.
 * Must start with a letter, 3-50 characters.
 *
 * Exported as the single source for client-side pre-validation (character
 * create modal, JSON import) — a client regex looser than this one lets
 * input through that the gateway then rejects with a raw 400.
 */
export const SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Friendly requirements line paired with SLUG_PATTERN for client error messages. */
export const SLUG_REQUIREMENTS_MESSAGE =
  'Slugs must start with a letter and contain only lowercase letters, numbers, and hyphens.';

/** Slug length bounds — mirror slugSchema's min/max for client-side pre-validation. */
export const SLUG_MIN_LENGTH = 3;

const slugSchema = z
  .string()
  .min(SLUG_MIN_LENGTH, 'slug must be at least 3 characters')
  .max(
    DISCORD_LIMITS.SLUG_MAX_LENGTH,
    `slug must be ${DISCORD_LIMITS.SLUG_MAX_LENGTH} characters or less`
  )
  .regex(
    SLUG_PATTERN,
    'slug must start with a letter and contain only lowercase letters, numbers, and hyphens'
  );

/**
 * Schema for creating a new personality.
 *
 * This is the unified schema for both admin and user create operations.
 * The difference in behavior (ownerId, isPublic defaults) is handled by the service layer.
 */
export const PersonalityCreateSchema = z.object({
  // Required fields — limits match Discord dashboard modal config
  name: z.string().min(1, 'name is required').max(255, 'name must be 255 characters or less'),
  slug: slugSchema,
  characterInfo: z
    .string()
    .min(1, 'characterInfo is required')
    .max(DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH),
  personalityTraits: z
    .string()
    .min(1, 'personalityTraits is required')
    .max(DISCORD_LIMITS.SHORT_PARAGRAPH_MAX_LENGTH),

  // Optional display name (defaults to name if not provided)
  displayName: nullableString(255),

  // Character definition (all optional) — limits match Discord dashboard modal config
  ...PersonalityCharacterFieldsSchema.shape,

  // Visibility - defaults to false, can be set to true to make public
  isPublic: z.boolean().optional(),

  // Definition visibility - defaults to false (private internals). Settable at
  // create/import time; the create route maps it (default false when absent).
  definitionPublic: z.boolean().optional(),

  // Custom fields (JSONB) - accepts arbitrary nested JSON to match Prisma Json? type
  customFields: z.record(z.string(), z.unknown()).optional().nullable(),

  // Avatar data (base64 encoded, processed separately).
  // null = no avatar — the bot-client dashboard only fetches `hasAvatar`, never
  // the base64, so it round-trips `avatarData: null` on every save. Accepting
  // null (treated as "no change" by processAvatarData) is required or that
  // round-trip 400s. See voiceReferenceData below for the same shape.
  avatarData: z.string().nullable().optional(),

  // Voice reference audio (base64 data URI, processed by voiceReferenceProcessor).
  // Schema only validates type — format/MIME/size validation is in the processor.
  // null = no voice reference (same round-trip rationale as avatarData above).
  voiceReferenceData: z.string().nullable().optional(),
});

export type PersonalityCreateInput = z.infer<typeof PersonalityCreateSchema>;

/**
 * Schema for updating an existing personality.
 *
 * All fields are optional - only provided fields are updated.
 * Empty strings are transformed to null for nullable fields.
 */
export const PersonalityUpdateSchema = z.object({
  // Core fields — limits match Discord dashboard modal config
  name: z.string().min(1).max(255).optional(),
  slug: slugSchema.optional(),
  displayName: nullableString(255),
  characterInfo: z.string().min(1).max(DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH).optional(),
  personalityTraits: z.string().min(1).max(DISCORD_LIMITS.SHORT_PARAGRAPH_MAX_LENGTH).optional(),

  // Character definition — limits match Discord dashboard modal config
  ...PersonalityCharacterFieldsSchema.shape,

  // Visibility
  isPublic: z.boolean().optional(),

  // Definition visibility — when false, non-owners see the card fields
  // redacted. Toggled via the /character edit dashboard (auto-forwarded by the
  // update route's simpleFields loop).
  definitionPublic: z.boolean().optional(),

  // Custom fields (JSONB) - accepts arbitrary nested JSON to match Prisma Json? type
  customFields: z.record(z.string(), z.unknown()).optional().nullable(),

  // Avatar data (base64 encoded, processed separately).
  // null = the dashboard round-trips a no-avatar character (it only fetches
  // `hasAvatar`, never the base64). processMediaUploads treats null as "no
  // change" — it never clears an existing avatar — so editing an unrelated
  // section is safe. Rejecting null here is the avatarData-class 400 bug.
  avatarData: z.string().nullable().optional(),

  // Explicit avatar clear. Because `avatarData: null` is the dashboard's
  // "no change" sentinel (above), clearing an avatar needs a distinct signal:
  // `clearAvatar: true` nulls the stored avatar. Ignored unless true.
  clearAvatar: z.boolean().optional(),

  // Voice reference audio (base64 data URI, processed separately)
  // null = clear existing voice reference, undefined = don't change, string = set new
  voiceReferenceData: z.string().nullable().optional(),

  // Voice toggle (auto-set by /character voice upload/clear)
  voiceEnabled: z.boolean().optional(),
});

export type PersonalityUpdateInput = z.infer<typeof PersonalityUpdateSchema>;

// ============================================================================
// PATCH /user/personality/:slug/visibility
// ============================================================================

export const SetVisibilitySchema = z.object({
  isPublic: z.boolean({ error: 'isPublic field is required' }),
});

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
  definitionPublic: true,
  voiceEnabled: true,
  imageEnabled: true,
  ownerId: true,
  avatarData: true,
  voiceReferenceType: true,
  customFields: true,
  systemPromptId: true,
  voiceSettings: true,
  imageSettings: true,
  createdAt: true,
  updatedAt: true,
} as const;
