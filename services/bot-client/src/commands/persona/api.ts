/**
 * Persona API Helpers
 *
 * Functions for fetching, updating, and deleting personas via the typed
 * gateway client.
 */

import { type PersonaUpdateInput } from '@tzurot/common-types/schemas/api/persona';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { GatewayApiError, nullOn404, type UserClient } from '@tzurot/clients';
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

  // A 404 is a normal miss (returned as null below, not logged); any other
  // failure is real, worth a persona-scoped trace before nullOn404 throws it.
  if (!result.ok && result.status !== 404) {
    logger.warn({ userId, personaId, error: result.error }, 'Failed to fetch persona');
  }

  // Pattern B: null ONLY on a genuine 404; nullOn404 throws InfraError (infra →
  // "try again") / GatewayClientError (non-404 4xx), so a transient blip never
  // reads to the user as "persona not found".
  return nullOn404(result)?.persona ?? null;
}

/**
 * Fetch the user's default persona
 */
export async function fetchDefaultPersona(
  userClient: UserClient,
  userId: string
): Promise<PersonaDetails | null> {
  const listResult = await userClient.listPersonas();

  if (!listResult.ok && listResult.status !== 404) {
    logger.warn({ userId, error: listResult.error }, 'Failed to fetch persona list');
  }

  // listPersonas has no meaningful 404 (an empty list is a 200 with []), so
  // nullOn404 effectively throws on every infra/4xx failure — a transient blip
  // can't read to the user as "you have no personas".
  const data = nullOn404(listResult);
  const defaultPersona = data?.personas.find((p: PersonaSummary) => p.isDefault);
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
): Promise<PersonaDetails> {
  const result = await userClient.updatePersona(personaId, data);

  if (!result.ok) {
    logger.warn({ userId, personaId, error: result.error }, 'Failed to update persona');
    // Throw (rather than return null) so the dashboard can surface the real
    // gateway message and distinguish an outcome-uncertain abort (timeout/network)
    // from an HTTP rejection — the same contract as updateCharacter / updatePreset.
    throw new GatewayApiError(
      `Failed to update persona: ${result.status} - ${result.error ?? 'Unknown'}`,
      result.status,
      result.kind
    );
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
  // nullOn404 throws on infra/4xx so the delete guard fails CLOSED — a transient
  // blip aborts the delete (the throw is caught upstream → "try again") rather
  // than reading "not default" and letting the user's default persona be deleted.
  const data = nullOn404(await userClient.listPersonas());
  const persona = data?.personas.find((p: PersonaSummary) => p.id === personaId);
  return persona?.isDefault ?? false;
}
