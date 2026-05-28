/**
 * Persona API Helpers
 *
 * Functions for fetching, updating, and deleting personas via the typed
 * gateway client.
 */

import { createLogger, type PersonaUpdateInput, type UserClient } from '@tzurot/common-types';
import type { PersonaDetails, PersonaSummary } from './types.js';

const logger = createLogger('persona-api');

/**
 * Fetch a specific persona by ID
 */
export async function fetchPersona(
  personaId: string,
  userClient: UserClient,
  userId: string
): Promise<PersonaDetails | null> {
  const result = await userClient.getPersona(personaId);

  if (!result.ok) {
    logger.warn({ userId, personaId, error: result.error }, 'Failed to fetch persona');
    return null;
  }

  return result.data.persona;
}

/**
 * Fetch the user's default persona
 */
export async function fetchDefaultPersona(
  userClient: UserClient,
  userId: string
): Promise<PersonaDetails | null> {
  const listResult = await userClient.listPersonas();

  if (!listResult.ok) {
    logger.warn({ userId, error: listResult.error }, 'Failed to fetch persona list');
    return null;
  }

  const defaultPersona = listResult.data.personas.find((p: PersonaSummary) => p.isDefault);
  if (defaultPersona === undefined) {
    return null;
  }

  return fetchPersona(defaultPersona.id, userClient, userId);
}

/**
 * Update a persona
 */
export async function updatePersona(
  personaId: string,
  data: PersonaUpdateInput,
  userClient: UserClient,
  userId: string
): Promise<PersonaDetails | null> {
  const result = await userClient.updatePersona(personaId, data);

  if (!result.ok) {
    logger.warn({ userId, personaId, error: result.error }, 'Failed to update persona');
    return null;
  }

  return result.data.persona;
}

/**
 * Delete a persona
 */
export async function deletePersona(
  personaId: string,
  userClient: UserClient,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const result = await userClient.deletePersona(personaId);

  if (!result.ok) {
    logger.warn({ userId, personaId, error: result.error }, 'Failed to delete persona');
    return { success: false, error: result.error };
  }

  return { success: true };
}

/**
 * Check if a persona is the default persona
 */
export async function isDefaultPersona(
  personaId: string,
  userClient: UserClient
): Promise<boolean> {
  const listResult = await userClient.listPersonas();

  if (!listResult.ok) {
    return false;
  }

  const persona = listResult.data.personas.find((p: PersonaSummary) => p.id === personaId);
  return persona?.isDefault ?? false;
}
