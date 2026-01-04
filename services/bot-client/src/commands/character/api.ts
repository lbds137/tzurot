/**
 * Character Command - API Client Functions
 *
 * Handles communication with the API gateway for character operations.
 * All functions use callGatewayApi which properly sets auth headers.
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import type { EnvConfig } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import type { CharacterData } from './config.js';

/**
 * API response type for personality endpoint
 * Note: canEdit is computed server-side using internal User UUIDs, not Discord IDs
 */
interface PersonalityResponse {
  personality: CharacterData;
  canEdit: boolean;
}

/**
 * Extended character data that includes canEdit flag from API
 */
export interface FetchedCharacter extends CharacterData {
  canEdit: boolean;
}

/**
 * API response type for personality list endpoint
 */
interface PersonalityListResponse {
  personalities: {
    id: string;
    name: string;
    displayName: string | null;
    slug: string;
    isOwned: boolean;
    isPublic: boolean;
    ownerId: string | null;
    ownerDiscordId: string | null;
  }[];
}

/**
 * Fetch a character by slug
 * Uses the /user/personality/:slug endpoint which requires user authentication
 * Returns character data with canEdit flag from server-side permission check
 */
export async function fetchCharacter(
  slugOrId: string,
  _config: EnvConfig,
  userId: string
): Promise<FetchedCharacter | null> {
  const result = await callGatewayApi<PersonalityResponse>(`/user/personality/${slugOrId}`, {
    userId,
  });

  if (!result.ok) {
    if (result.status === 404 || result.status === 403) {
      return null;
    }
    throw new Error(`Failed to fetch character: ${result.status}`);
  }

  // Include canEdit from API response - this is the authoritative permission check
  return {
    ...result.data.personality,
    canEdit: result.data.canEdit,
  };
}

/**
 * Fetch all characters visible to a user (owned + public)
 * Returns two arrays: user's owned characters and public characters from others
 */
export async function fetchAllCharacters(
  userId: string,
  _config: EnvConfig
): Promise<{ owned: CharacterData[]; publicOthers: CharacterData[] }> {
  const result = await callGatewayApi<PersonalityListResponse>('/user/personality', {
    userId,
  });

  if (!result.ok) {
    throw new Error(`Failed to fetch characters: ${result.status}`);
  }

  const data = result.data;

  // The list endpoint returns summaries, but we need full data for the dashboard
  // For now, just return the summaries cast to CharacterData (we'll fetch full data when editing)
  const owned: CharacterData[] = [];
  const publicOthers: CharacterData[] = [];

  for (const p of data.personalities) {
    const charData = {
      id: p.id,
      name: p.name,
      displayName: p.displayName,
      slug: p.slug,
      isPublic: p.isPublic,
      ownerId: p.ownerDiscordId, // Use Discord ID for fetching display names
      // These fields are not in the list response, but needed for CharacterData interface
      characterInfo: '',
      personalityTraits: '',
      personalityTone: null,
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
      voiceEnabled: false,
      imageEnabled: false,
      avatarData: null,
      createdAt: '',
      updatedAt: '',
    } as CharacterData;

    // Use ownerDiscordId for categorization (not isOwned which is true for bot owner on all)
    // This ensures bot owner sees proper "Your Characters" vs "Others' Characters" separation
    if (p.ownerDiscordId === userId) {
      owned.push(charData);
    } else {
      publicOthers.push(charData);
    }
  }

  return { owned, publicOthers };
}

/**
 * Fetch characters owned by user (wrapper for fetchAllCharacters)
 */
export async function fetchUserCharacters(
  userId: string,
  config: EnvConfig
): Promise<CharacterData[]> {
  const { owned } = await fetchAllCharacters(userId, config);
  return owned;
}

/**
 * Fetch public characters from others (wrapper for fetchAllCharacters)
 */
export async function fetchPublicCharacters(
  userId: string,
  config: EnvConfig
): Promise<CharacterData[]> {
  const { publicOthers } = await fetchAllCharacters(userId, config);
  return publicOthers;
}

/**
 * Fetch Discord usernames for a list of user IDs
 */
export async function fetchUsernames(
  client: ChatInputCommandInteraction['client'],
  userIds: string[]
): Promise<Map<string, string>> {
  const names = new Map<string, string>();

  await Promise.all(
    userIds.map(async id => {
      try {
        const user = await client.users.fetch(id);
        names.set(id, user.displayName ?? user.username);
      } catch {
        names.set(id, 'Unknown');
      }
    })
  );

  return names;
}

/**
 * Create a new character
 */
export async function createCharacter(
  data: Partial<CharacterData> & {
    name: string;
    slug: string;
    characterInfo: string;
    personalityTraits: string;
  },
  userId: string,
  _config: EnvConfig
): Promise<CharacterData> {
  const result = await callGatewayApi<{ success: boolean; personality: CharacterData }>(
    '/user/personality',
    {
      method: 'POST',
      userId,
      body: data,
    }
  );

  if (!result.ok) {
    throw new Error(`Failed to create character: ${result.status} - ${result.error}`);
  }

  return result.data.personality;
}

/**
 * Update a character
 */
export async function updateCharacter(
  slug: string,
  data: Partial<CharacterData>,
  userId: string,
  _config: EnvConfig
): Promise<CharacterData> {
  const result = await callGatewayApi<{ success: boolean; personality: CharacterData }>(
    `/user/personality/${slug}`,
    {
      method: 'PUT',
      userId,
      body: data,
    }
  );

  if (!result.ok) {
    throw new Error(`Failed to update character: ${result.status} - ${result.error}`);
  }

  return result.data.personality;
}

/**
 * Toggle character visibility
 */
export async function toggleVisibility(
  slug: string,
  isPublic: boolean,
  userId: string,
  _config: EnvConfig
): Promise<{ id: string; slug: string; isPublic: boolean }> {
  const result = await callGatewayApi<{
    success: boolean;
    personality: { id: string; slug: string; isPublic: boolean };
  }>(`/user/personality/${slug}/visibility`, {
    method: 'PATCH',
    userId,
    body: { isPublic },
  });

  if (!result.ok) {
    throw new Error(`Failed to toggle visibility: ${result.status} - ${result.error}`);
  }

  return result.data.personality;
}
