/**
 * Shared personality response formatting.
 *
 * Used by both GET and PUT personality endpoints to produce
 * a consistent API response shape.
 */

import {
  type PERSONALITY_DETAIL_SELECT,
  type PersonalityCharacterFields,
} from '@tzurot/common-types/schemas/api/personality';
import { type Prisma } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { deriveAvatarUrl } from '@tzurot/identity';

const logger = createLogger('personality-formatter');

type PersonalityFromDb = Prisma.PersonalityGetPayload<{
  select: typeof PERSONALITY_DETAIL_SELECT;
}>;

/**
 * The card fields redacted for non-owners when a character's definition is
 * private. Everything NOT in this list is safe to show anyone who can see the
 * character (name, avatar presence, visibility flags, timestamps). Single
 * source: the type union AND the runtime redaction pass both derive from this
 * tuple, so a new card field is added in exactly one place.
 */
export const REDACTABLE_CARD_FIELDS = [
  'characterInfo',
  'personalityTraits',
  'personalityTone',
  'personalityAge',
  'personalityAppearance',
  'personalityLikes',
  'personalityDislikes',
  'conversationalGoals',
  'conversationalExamples',
  'errorMessage',
  'customFields',
] as const;

type RedactableCardField = (typeof REDACTABLE_CARD_FIELDS)[number];

export interface PersonalityResponse extends Omit<PersonalityCharacterFields, RedactableCardField> {
  id: string;
  name: string;
  displayName: string | null;
  slug: string;
  // Nullable because they are redacted to null for a non-owner of a
  // definition-private character (see formatPersonalityResponse's `redact`).
  characterInfo: string | null;
  personalityTraits: string | null;
  personalityTone: string | null;
  personalityAge: string | null;
  personalityAppearance: string | null;
  personalityLikes: string | null;
  personalityDislikes: string | null;
  conversationalGoals: string | null;
  conversationalExamples: string | null;
  errorMessage: string | null;
  birthMonth: number | null;
  birthDay: number | null;
  birthYear: number | null;
  isPublic: boolean;
  definitionPublic: boolean;
  definitionRedacted: boolean;
  voiceEnabled: boolean;
  imageEnabled: boolean;
  ownerId: string;
  hasAvatar: boolean;
  /** Public cache-busting avatar URL (null = no avatar). Derived here, where
   *  PUBLIC_GATEWAY_URL exists — bot-client's GATEWAY_URL is internal-only. */
  avatarUrl: string | null;
  hasVoiceReference: boolean;
  // Matches PersonalityFullSchema's declared shape — the create/update
  // schemas only ever store records in the Json? column.
  customFields: Record<string, unknown> | null;
  systemPromptId: string | null;
  voiceSettings: unknown;
  imageSettings: unknown;
  createdAt: string;
  updatedAt: string;
}

/**
 * Format a personality row for the API.
 *
 * @param opts.redact - When true, the character card fields are nulled and
 *   `definitionRedacted` is set. The CALLER decides policy (the GET route
 *   computes `!canViewDefinition`); the owner-only PUT/create callers pass
 *   `false`. Threading the flag keeps one field list and one code path — a new
 *   card field is added in exactly one place and can't leak via a forgotten
 *   redaction site.
 */
export function formatPersonalityResponse(
  personality: NonNullable<PersonalityFromDb>,
  opts: { redact: boolean }
): PersonalityResponse {
  const { redact } = opts;
  const response: PersonalityResponse = {
    id: personality.id,
    name: personality.name,
    displayName: personality.displayName,
    slug: personality.slug,
    characterInfo: personality.characterInfo,
    personalityTraits: personality.personalityTraits,
    personalityTone: personality.personalityTone,
    personalityAge: personality.personalityAge,
    personalityAppearance: personality.personalityAppearance,
    personalityLikes: personality.personalityLikes,
    personalityDislikes: personality.personalityDislikes,
    conversationalGoals: personality.conversationalGoals,
    conversationalExamples: personality.conversationalExamples,
    errorMessage: personality.errorMessage,
    birthMonth: personality.birthMonth,
    birthDay: personality.birthDay,
    birthYear: personality.birthYear,
    isPublic: personality.isPublic,
    definitionPublic: personality.definitionPublic,
    definitionRedacted: redact,
    voiceEnabled: personality.voiceEnabled,
    imageEnabled: personality.imageEnabled,
    ownerId: personality.ownerId,
    hasAvatar: personality.avatarData !== null,
    avatarUrl:
      personality.avatarData !== null
        ? (deriveAvatarUrl(personality.slug, personality.updatedAt, logger) ?? null)
        : null,
    // voiceReferenceType (not voiceReferenceData) is the proxy — PERSONALITY_DETAIL_SELECT
    // excludes the blob column to avoid loading up to 10MB into memory on every query.
    hasVoiceReference: personality.voiceReferenceType !== null,
    // Prisma types Json? as JsonValue; the create/update schemas only ever
    // accept records, so the stored value is a record (or null) by invariant.
    customFields: (personality.customFields ?? null) as Record<string, unknown> | null,
    systemPromptId: personality.systemPromptId,
    voiceSettings: personality.voiceSettings,
    imageSettings: personality.imageSettings,
    createdAt: personality.createdAt.toISOString(),
    updatedAt: personality.updatedAt.toISOString(),
  };

  if (redact) {
    for (const field of REDACTABLE_CARD_FIELDS) {
      response[field] = null;
    }
  }

  return response;
}
