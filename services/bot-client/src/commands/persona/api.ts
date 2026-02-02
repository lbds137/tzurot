/**
 * Persona API Helpers
 *
 * Functions for fetching, updating, and deleting personas via the gateway API.
 */

import { createLogger, type ListPersonasResponse } from '@tzurot/common-types';
import { callGatewayApi, GATEWAY_TIMEOUTS } from '../../utils/userGatewayClient.js';
import type { PersonaDetails, PersonaSummary, SavePersonaResponse } from './types.js';

const logger = createLogger('persona-api');

/**
 * Fetch a specific persona by ID
 */
export async function fetchPersona(
  personaId: string,
  userId: string
): Promise<PersonaDetails | null> {
  const result = await callGatewayApi<{ persona: PersonaDetails }>(`/user/persona/${personaId}`, {
    userId,
    timeout: GATEWAY_TIMEOUTS.DEFERRED,
  });

  if (!result.ok) {
    logger.warn({ userId, personaId, error: result.error }, 'Failed to fetch persona');
    return null;
  }

  return result.data.persona;
}

/**
 * Fetch the user's default persona
 */
export async function fetchDefaultPersona(userId: string): Promise<PersonaDetails | null> {
  const listResult = await callGatewayApi<ListPersonasResponse>('/user/persona', { userId, timeout: GATEWAY_TIMEOUTS.DEFERRED });

  if (!listResult.ok) {
    logger.warn({ userId, error: listResult.error }, 'Failed to fetch persona list');
    return null;
  }

  const defaultPersona = listResult.data.personas.find((p: PersonaSummary) => p.isDefault);
  if (defaultPersona === undefined) {
    return null;
  }

  return fetchPersona(defaultPersona.id, userId);
}

/**
 * Update a persona
 */
export async function updatePersona(
  personaId: string,
  data: Record<string, unknown>,
  userId: string
): Promise<PersonaDetails | null> {
  const result = await callGatewayApi<SavePersonaResponse>(`/user/persona/${personaId}`, {
    method: 'PUT',
    userId,
    body: data,
    timeout: GATEWAY_TIMEOUTS.DEFERRED,
  });

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
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const result = await callGatewayApi<{ message: string }>(`/user/persona/${personaId}`, {
    method: 'DELETE',
    userId,
    timeout: GATEWAY_TIMEOUTS.DEFERRED,
  });

  if (!result.ok) {
    logger.warn({ userId, personaId, error: result.error }, 'Failed to delete persona');
    return { success: false, error: result.error };
  }

  return { success: true };
}

/**
 * Check if a persona is the default persona
 */
export async function isDefaultPersona(personaId: string, userId: string): Promise<boolean> {
  const listResult = await callGatewayApi<ListPersonasResponse>('/user/persona', { userId, timeout: GATEWAY_TIMEOUTS.DEFERRED });

  if (!listResult.ok) {
    return false;
  }

  const persona = listResult.data.personas.find((p: PersonaSummary) => p.id === personaId);
  return persona?.isDefault ?? false;
}
