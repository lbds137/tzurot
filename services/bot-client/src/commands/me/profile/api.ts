/**
 * Profile API Helpers
 *
 * Functions for fetching, updating, and deleting profiles via the gateway API.
 */

import { createLogger, type ListPersonasResponse } from '@tzurot/common-types';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';
import type { PersonaDetails, PersonaSummary, SavePersonaResponse } from './types.js';

const logger = createLogger('profile-api');

/**
 * Fetch a specific profile by ID
 */
export async function fetchProfile(
  profileId: string,
  userId: string
): Promise<PersonaDetails | null> {
  const result = await callGatewayApi<{ persona: PersonaDetails }>(`/user/persona/${profileId}`, {
    userId,
  });

  if (!result.ok) {
    logger.warn({ userId, profileId, error: result.error }, 'Failed to fetch profile');
    return null;
  }

  return result.data.persona;
}

/**
 * Fetch the user's default profile
 */
export async function fetchDefaultProfile(userId: string): Promise<PersonaDetails | null> {
  const listResult = await callGatewayApi<ListPersonasResponse>('/user/persona', { userId });

  if (!listResult.ok) {
    logger.warn({ userId, error: listResult.error }, 'Failed to fetch persona list');
    return null;
  }

  const defaultPersona = listResult.data.personas.find((p: PersonaSummary) => p.isDefault);
  if (defaultPersona === undefined) {
    return null;
  }

  return fetchProfile(defaultPersona.id, userId);
}

/**
 * Update a profile
 */
export async function updateProfile(
  profileId: string,
  data: Record<string, unknown>,
  userId: string
): Promise<PersonaDetails | null> {
  const result = await callGatewayApi<SavePersonaResponse>(`/user/persona/${profileId}`, {
    method: 'PUT',
    userId,
    body: data,
  });

  if (!result.ok) {
    logger.warn({ userId, profileId, error: result.error }, 'Failed to update profile');
    return null;
  }

  return result.data.persona;
}

/**
 * Delete a profile
 */
export async function deleteProfile(
  profileId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const result = await callGatewayApi<{ message: string }>(`/user/persona/${profileId}`, {
    method: 'DELETE',
    userId,
  });

  if (!result.ok) {
    logger.warn({ userId, profileId, error: result.error }, 'Failed to delete profile');
    return { success: false, error: result.error };
  }

  return { success: true };
}

/**
 * Check if a profile is the default profile
 */
export async function isDefaultProfile(profileId: string, userId: string): Promise<boolean> {
  const listResult = await callGatewayApi<ListPersonasResponse>('/user/persona', { userId });

  if (!listResult.ok) {
    return false;
  }

  const profile = listResult.data.personas.find((p: PersonaSummary) => p.id === profileId);
  return profile?.isDefault ?? false;
}
