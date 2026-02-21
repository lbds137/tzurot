/**
 * Shared personality response formatting.
 *
 * Used by both GET and PUT personality endpoints to produce
 * a consistent API response shape.
 */

import { Prisma, PERSONALITY_DETAIL_SELECT } from '@tzurot/common-types';

type PersonalityFromDb = Prisma.PersonalityGetPayload<{
  select: typeof PERSONALITY_DETAIL_SELECT;
}>;

export interface PersonalityResponse {
  id: string;
  name: string;
  displayName: string | null;
  slug: string;
  characterInfo: string;
  personalityTraits: string;
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
  voiceEnabled: boolean;
  imageEnabled: boolean;
  ownerId: string;
  hasAvatar: boolean;
  customFields: unknown;
  systemPromptId: string | null;
  voiceSettings: unknown;
  imageSettings: unknown;
  createdAt: string;
  updatedAt: string;
}

export function formatPersonalityResponse(
  personality: NonNullable<PersonalityFromDb>
): PersonalityResponse {
  return {
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
    voiceEnabled: personality.voiceEnabled,
    imageEnabled: personality.imageEnabled,
    ownerId: personality.ownerId,
    hasAvatar: personality.avatarData !== null,
    customFields: personality.customFields,
    systemPromptId: personality.systemPromptId,
    voiceSettings: personality.voiceSettings,
    imageSettings: personality.imageSettings,
    createdAt: personality.createdAt.toISOString(),
    updatedAt: personality.updatedAt.toISOString(),
  };
}
