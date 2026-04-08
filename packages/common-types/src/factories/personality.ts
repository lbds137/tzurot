/**
 * Validated Mock Factories for Personality API Responses
 *
 * These factories create mock data that is VALIDATED against the Zod schemas.
 * If a test tries to mock an invalid shape, it will CRASH immediately.
 */

import {
  CreatePersonalityResponseSchema,
  GetPersonalityResponseSchema,
  ListPersonalitiesResponseSchema,
  type CreatePersonalityResponse,
  type GetPersonalityResponse,
  type ListPersonalitiesResponse,
  type PersonalityFull,
} from '../schemas/api/personality.js';

// Default UUIDs for consistent test data (RFC 4122 compliant v5 UUIDs)
const DEFAULT_PERSONALITY_ID = '33333333-3333-5333-8333-333333333333';
const DEFAULT_OWNER_ID = '44444444-4444-5444-8444-444444444444';
const DEFAULT_SLUG = 'test-character';
const DEFAULT_DISPLAY_NAME = 'Test Character';

/** Base personality data with all required fields */
function createBasePersonality(overrides?: Partial<PersonalityFull>): PersonalityFull {
  const now = new Date().toISOString();
  return {
    id: DEFAULT_PERSONALITY_ID,
    name: 'TestCharacter',
    slug: DEFAULT_SLUG,
    displayName: DEFAULT_DISPLAY_NAME,
    characterInfo: 'A test character for unit tests',
    personalityTraits: 'Friendly, helpful',
    personalityTone: 'Casual and warm',
    personalityAge: null,
    personalityAppearance: null,
    personalityLikes: null,
    personalityDislikes: null,
    conversationalGoals: null,
    conversationalExamples: null,
    errorMessage: null,
    birthMonth: null,
    birthDay: null,
    birthYear: null,
    isPublic: false,
    voiceEnabled: false,
    imageEnabled: false,
    ownerId: DEFAULT_OWNER_ID,
    hasAvatar: false,
    hasVoiceReference: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a validated mock for POST /user/personality
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockCreatePersonalityResponse(
  overrides?: Partial<PersonalityFull>
): CreatePersonalityResponse {
  return CreatePersonalityResponseSchema.parse({
    success: true,
    personality: createBasePersonality(overrides),
  });
}

/**
 * Create a validated mock for GET /user/personality/:slug
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockGetPersonalityResponse(
  overrides?: Partial<PersonalityFull>
): GetPersonalityResponse {
  return GetPersonalityResponseSchema.parse({
    personality: createBasePersonality(overrides),
  });
}

/** Type for list personalities overrides */
interface PersonalitySummaryOverrides {
  id?: string;
  name?: string;
  slug?: string;
  displayName?: string | null;
  isPublic?: boolean;
  isOwned?: boolean;
  ownerId?: string;
  ownerDiscordId?: string;
  permissions?: { canEdit: boolean; canDelete: boolean };
}

/**
 * Create a validated mock for GET /user/personality (list)
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockListPersonalitiesResponse(
  personalities?: PersonalitySummaryOverrides[]
): ListPersonalitiesResponse {
  const defaultList = [
    {
      id: DEFAULT_PERSONALITY_ID,
      name: 'TestCharacter',
      slug: DEFAULT_SLUG,
      displayName: DEFAULT_DISPLAY_NAME,
      isPublic: false,
      isOwned: true,
      ownerId: DEFAULT_OWNER_ID,
      ownerDiscordId: '123456789012345678',
      permissions: { canEdit: true, canDelete: true },
    },
  ];

  return ListPersonalitiesResponseSchema.parse({
    personalities:
      personalities?.map((p, i) => ({
        // When `id` and `slug` aren't overridden, generate unique values
        // per index. Discord select menus reject duplicate option values,
        // and `buildBrowseSelectMenu` throws on them — multi-personality
        // tests must produce structurally valid lists. Index 0 keeps
        // DEFAULT_* values for backwards compatibility with
        // single-personality tests.
        id:
          p.id ??
          (i === 0
            ? DEFAULT_PERSONALITY_ID
            : `33333333-3333-5333-8333-${i.toString(16).padStart(12, '0')}`),
        name: p.name ?? 'TestCharacter',
        slug: p.slug ?? (i === 0 ? DEFAULT_SLUG : `${DEFAULT_SLUG}-${i.toString()}`),
        displayName: p.displayName ?? DEFAULT_DISPLAY_NAME,
        isPublic: p.isPublic ?? false,
        isOwned: p.isOwned ?? true,
        ownerId: p.ownerId ?? DEFAULT_OWNER_ID,
        ownerDiscordId: p.ownerDiscordId ?? '123456789012345678',
        permissions: p.permissions ?? { canEdit: true, canDelete: true },
      })) ?? defaultList,
  });
}
