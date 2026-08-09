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
// Character tags
// ============================================================================

/** Bounds for owner-authored discovery tags (single global namespace). */
export const TAG_LIMITS = {
  /** Max tags stored on one character. */
  MAX_PER_CHARACTER: 10,
  /** Minimum length of a single normalized tag. */
  MIN_LENGTH: 2,
  /** Maximum length of a single normalized tag. */
  MAX_LENGTH: 32,
} as const;

/**
 * Length of the longest legitimate comma-joined tag list: every tag at its
 * maximum length, separated by `, `. Exported so the Discord modal field can
 * size itself from the same arithmetic instead of restating it.
 */
export const MAX_JOINED_TAGS_LENGTH =
  TAG_LIMITS.MAX_PER_CHARACTER * TAG_LIMITS.MAX_LENGTH + (TAG_LIMITS.MAX_PER_CHARACTER - 1) * 2;

/**
 * Slack multiplier between the longest legitimate input and the raw-size
 * ceilings below. Generous on purpose: the ceilings exist to bound WORK, not
 * to enforce the tag rules (the per-tag and per-character limits do that), so
 * a user who pastes a sloppy over-long list should still get the specific
 * "too many tags" error rather than a blunt size rejection.
 */
const RAW_INPUT_SLACK = 8;

/**
 * Ceilings applied to the RAW input before any per-token work happens. The
 * gateway's JSON body limit is measured in megabytes, so without these a
 * single request could hand the normalize/dedupe loop an arbitrary number of
 * tokens and only be rejected by the 10-tag cap afterwards. Bounding the raw
 * shape first means Zod rejects at the schema edge and the loop never runs.
 */
export const TAG_INPUT_LIMITS = {
  /** Longest accepted comma-separated string (the dashboard modal arm). */
  MAX_RAW_STRING_LENGTH: MAX_JOINED_TAGS_LENGTH * RAW_INPUT_SLACK,
  /** Most elements accepted in the array arm before per-element checks. */
  MAX_RAW_ARRAY_LENGTH: TAG_LIMITS.MAX_PER_CHARACTER * RAW_INPUT_SLACK,
  /** Longest accepted single raw array element. */
  MAX_RAW_ELEMENT_LENGTH: TAG_LIMITS.MAX_LENGTH * RAW_INPUT_SLACK,
} as const;

/**
 * Shape of a normalized tag: lowercase alphanumerics and hyphens, starting
 * with an alphanumeric. Exported so a UI layer can pre-validate against the
 * same shape the gateway enforces rather than surfacing a raw 400; nothing
 * currently consumes it that way.
 */
export const TAG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Normalize one raw tag token: trim, lowercase, collapse whitespace runs to a
 * single hyphen, then apply separator hygiene — collapse hyphen runs and trim
 * leading/trailing hyphens.
 *
 * The hyphen steps are deliberate and differ from how content characters are
 * treated: the hyphen is the separator WE introduce for whitespace, so
 * `sci -- fi` and `sci fi` are the same authored intent and must normalize to
 * one stored tag. A CONTENT character carries meaning the author typed, so it
 * is validated rather than rewritten — `Sci Fi!` normalizes to `sci-fi!` and
 * is then REJECTED, because silently dropping the `!` would store a tag the
 * author never typed.
 */
export function normalizeTag(raw: string): string {
  const hyphenated = raw.trim().toLowerCase().replace(/\s+/g, '-');
  // Splitting on the separator and dropping empty segments collapses hyphen
  // RUNS and trims EDGE hyphens in one linear pass. The equivalent `/-+/g`
  // replace is rejected by regexp/no-super-linear-move (quadratic scan).
  return hyphenated
    .split('-')
    .filter(segment => segment.length > 0)
    .join('-');
}

/** One tag: normalized first, then bounds- and shape-checked. */
export const PersonalityTagSchema = z
  .string()
  .transform(normalizeTag)
  .pipe(
    z
      .string()
      .min(TAG_LIMITS.MIN_LENGTH, `each tag must be at least ${TAG_LIMITS.MIN_LENGTH} characters`)
      .max(TAG_LIMITS.MAX_LENGTH, `each tag must be ${TAG_LIMITS.MAX_LENGTH} characters or less`)
      .regex(
        TAG_PATTERN,
        'tags may contain only lowercase letters, numbers, and hyphens, and must start with a letter or number'
      )
  );

/** Split a comma-separated tag string into raw tokens. */
function splitTagString(value: string): string[] {
  return value.split(',');
}

/**
 * Tag input accepted on create/update: either a comma-separated string (the
 * Discord dashboard's modal value, which arrives as one text field) or an
 * array (JSON import / API clients). Both arms normalize, drop empties, and
 * dedupe preserving first-seen order before the per-tag rules and the
 * per-character cap apply. The string arm exists so the dashboard round-trip
 * needs zero client-side parsing.
 *
 * The `.max()` bounds on the union arms run BEFORE the transform, so an
 * oversized body is rejected at the schema edge instead of being tokenized
 * first (see TAG_INPUT_LIMITS).
 */
export const PersonalityTagsInputSchema = z
  .union([
    z
      .string()
      .max(
        TAG_INPUT_LIMITS.MAX_RAW_STRING_LENGTH,
        `tags input must be ${TAG_INPUT_LIMITS.MAX_RAW_STRING_LENGTH} characters or less`
      ),
    z
      .array(
        z
          .string()
          .max(
            TAG_INPUT_LIMITS.MAX_RAW_ELEMENT_LENGTH,
            `each tag must be ${TAG_INPUT_LIMITS.MAX_RAW_ELEMENT_LENGTH} characters or less`
          )
      )
      .max(
        TAG_INPUT_LIMITS.MAX_RAW_ARRAY_LENGTH,
        `tags input must contain at most ${TAG_INPUT_LIMITS.MAX_RAW_ARRAY_LENGTH} entries`
      ),
  ])
  .transform(value => {
    const rawTokens = typeof value === 'string' ? splitTagString(value) : value;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const token of rawTokens) {
      const normalized = normalizeTag(token);
      // Empty-after-normalize tokens drop SILENTLY here, while the single-tag
      // schema rejects the same input (e.g. '---'). Intentional asymmetry: in
      // a list, an empty token is usually a comma artifact ('a,,b,'), and a
      // separator-only token loses no authored content when dropped — unlike
      // stripping a content character, which the reject-don't-strip rule bans.
      if (normalized === '' || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  })
  .pipe(
    z
      .array(PersonalityTagSchema)
      .max(TAG_LIMITS.MAX_PER_CHARACTER, `at most ${TAG_LIMITS.MAX_PER_CHARACTER} tags are allowed`)
  );

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
  /**
   * Owner-authored discovery tags (normalized lowercase kebab tokens).
   * `.default([])` keeps a new client parsing an older gateway's tagless
   * response during a rolling deploy instead of failing the whole row.
   */
  tags: z.array(z.string()).default([]),
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
  /**
   * Public, cache-busting avatar URL, or null when the character has none.
   * Derived GATEWAY-side (identity's deriveAvatarUrl over PUBLIC_GATEWAY_URL)
   * because bot-client's own GATEWAY_URL is the internal hostname — a URL
   * built from it renders as a broken image when Discord's media proxy is
   * the fetcher (thumbnails), even though the bot's own fetches succeed.
   * Must be DECLARED here or strip-mode deletes it (see customFields note).
   */
  avatarUrl: z.string().nullable(),
  hasVoiceReference: z.boolean(),
  // Must be DECLARED here or the typed client's Zod parse (default strip mode)
  // silently drops it from every response — the gateway sends it, but an
  // undeclared key never reaches bot-client (export round-trip depends on it).
  // Null when the character has none OR when redacted (see definitionRedacted).
  customFields: z.record(z.string(), z.unknown()).nullable(),
  /**
   * Owner-authored discovery tags. Declared here for the same strip-mode
   * reason as customFields above — an undeclared key never reaches
   * bot-client. NOT redacted for a definition-private character: tags are
   * discovery metadata like the name. `.default([])` keeps a new client
   * parsing an older gateway's tagless response during a rolling deploy.
   */
  tags: z.array(z.string()).default([]),
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
  /** GLOBAL alias rows the new character's name/slug now shadows (the
   *  resolver checks names/slugs before aliases, so those aliases stop
   *  resolving). Warn-don't-block: creation succeeded; present only when
   *  non-empty so the client renders a ⚠️ note. Personal aliases are
   *  never reported here (privacy — they belong to other users). */
  shadowedAliases: z.array(z.string()).optional(),
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
  /** Set only by the UPDATE handler after a name/slug change: GLOBAL alias
   *  rows the new name/slug now shadows (warn-don't-block — the rename
   *  succeeded). GET never populates it. */
  shadowedAliases: z.array(z.string()).optional(),
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

  // Discovery tags — comma-separated string (dashboard modal) or array (JSON
  // import). Absent = no tags on the new character.
  tags: PersonalityTagsInputSchema.optional(),

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

  // Discovery tags — comma-separated string (dashboard modal) or array (the
  // fetched character's own `tags`, replayed on every section save). Absent =
  // leave the stored tags untouched; an empty string or [] clears them.
  tags: PersonalityTagsInputSchema.optional(),

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

  // Voice toggle (auto-set by /character voice set|clear)
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
  tags: true,
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
  tags: true,
  systemPromptId: true,
  voiceSettings: true,
  imageSettings: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ============================================================================
// Personality aliases — v2-parity management surface over personality_aliases
// (the rows also resolve @mentions via PersonalityLoader step 2).
// ============================================================================

/** Alias tiers: 'global' rows (user_id IS NULL — bot-owner-blessed, resolve
 *  for everyone) vs 'user' rows (personal — resolve only for their owner,
 *  checked before global in the resolver's alias step). */
export const AliasScopeSchema = z.enum(['global', 'user']);
export type AliasScope = z.infer<typeof AliasScopeSchema>;

export const PersonalityAliasEntrySchema = z.object({
  alias: z.string(),
  scope: AliasScopeSchema,
  createdAt: z.string().datetime(),
});

export const ListPersonalityAliasesResponseSchema = z.object({
  /** Global rows plus the CALLER's own personal rows — never other users'. */
  aliases: z.array(PersonalityAliasEntrySchema),
  /** True when rows were dropped at the read cap — UI shows a truncation footer. */
  truncated: z.boolean(),
});

export const AddPersonalityAliasRequestSchema = z.object({
  /** The alias text. '@' is forbidden anywhere — the mention parser splits on
   *  it, so such an alias could never match; rejecting beats silent deadness. */
  alias: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine(value => !value.includes('@'), {
      message: 'Aliases cannot contain "@" — mentions split on it, so it could never match',
    }),
  /** Which tier to write. Defaults to 'user' (a personal alias any caller may
   *  create on any visible character). 'global' is bot-owner-only. */
  scope: AliasScopeSchema.default('user'),
});

export const AddPersonalityAliasResponseSchema = z.object({
  alias: PersonalityAliasEntrySchema,
});

export const RemovePersonalityAliasResponseSchema = z.object({
  removedAlias: z.string(),
  removedScope: AliasScopeSchema,
});

// Cross-character alias overview (GET /user/personality/my-aliases): the
// caller's personal rows across all characters, plus every global row for
// the bot owner. The browse surface's no-filter mode.

export const MyAliasEntrySchema = z.object({
  alias: z.string(),
  scope: AliasScopeSchema,
  personality: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
  }),
  /** True when a character name/slug VISIBLE TO THE CALLER currently equals
   *  this alias — the resolver checks names/slugs first, so the alias is
   *  dead for its owner until the collision clears. Powers the ⚠️ badge in
   *  the owner's own browse (no privacy leak: computed per-caller). */
  shadowed: z.boolean(),
  createdAt: z.string().datetime(),
});

export const ListMyAliasesResponseSchema = z.object({
  aliases: z.array(MyAliasEntrySchema),
  /** True when rows were dropped at the read cap — UI shows a truncation footer. */
  truncated: z.boolean(),
});
