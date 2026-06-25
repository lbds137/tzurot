/**
 * Memory Command Autocomplete
 * Handles autocomplete for personality selection and provides
 * helper functions for resolving personality IDs.
 */

import type { AutocompleteInteraction } from 'discord.js';
import type { UserClient } from '@tzurot/clients';
import { handlePersonalityAutocomplete as sharedPersonalityAutocomplete } from '../../utils/autocomplete/personalityAutocomplete.js';
import { getCachedPersonalities } from '../../utils/autocomplete/autocompleteCache.js';

/**
 * Handle personality autocomplete for memory commands
 * Uses the shared personality autocomplete utility for consistency
 */
export async function handlePersonalityAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  await sharedPersonalityAutocomplete(interaction, {
    optionName: 'character',
    showVisibility: true,
    ownedOnly: false, // Show all accessible personalities
    valueField: 'slug', // Return slug as value (user-friendly)
  });
}

/**
 * Tri-state result of resolving a personality slug/ID/name to a UUID.
 *
 * The `not-found` vs `unavailable` split is the whole point: a genuine miss
 * (the personality list loaded fine but the slug isn't in it) must surface a
 * definitive "not found", while an infra failure fetching the list must surface
 * "try again". Collapsing both to `null` was the infra-vs-negative bug — an
 * unreachable gateway told the user their character "doesn't exist".
 */
export type ResolvedPersonality =
  | { kind: 'found'; id: string }
  | { kind: 'not-found' }
  | { kind: 'unavailable' };

/**
 * Resolve a personality slug/ID/name to its UUID via the autocomplete cache.
 *
 * @param userClient - Typed gateway client bound to the caller (for cache lookup)
 * @param slugOrId - Personality slug or ID from user input
 * @returns a {@link ResolvedPersonality} — `found` with the UUID, `not-found`
 *   when the list loaded but the input matched nothing, or `unavailable` when
 *   the personality list itself couldn't be fetched (infra failure).
 */
export async function resolvePersonalityId(
  userClient: UserClient,
  slugOrId: string
): Promise<ResolvedPersonality> {
  const result = await getCachedPersonalities(userClient);
  if (result.kind === 'error') {
    // Fetching the personality list FAILED (network/5xx/etc.) — this is NOT a
    // genuine miss. Signal "unavailable" so callers show "try again" rather than
    // a false "not found". (getCachedPersonalities only returns `error` on a
    // fetch failure; a successful fetch returns `ok` with a possibly-empty list.)
    return { kind: 'unavailable' };
  }
  const personalities = result.value;

  // Try to find by slug first (most common case from autocomplete)
  const bySlug = personalities.find(p => p.slug === slugOrId);
  if (bySlug !== undefined) {
    return { kind: 'found', id: bySlug.id };
  }

  // Try to find by ID (in case user pasted an ID directly)
  const byId = personalities.find(p => p.id === slugOrId);
  if (byId !== undefined) {
    return { kind: 'found', id: byId.id };
  }

  // Try to find by name (fuzzy match for user convenience)
  const byName = personalities.find(p => p.name.toLowerCase() === slugOrId.toLowerCase());
  if (byName !== undefined) {
    return { kind: 'found', id: byName.id };
  }

  // List loaded fine, input genuinely matched nothing.
  return { kind: 'not-found' };
}

/**
 * Get a personality's display name by ID
 *
 * @param userClient - Typed gateway client bound to the caller (for cache lookup)
 * @param personalityId - Personality UUID
 * @returns Personality display name or null if not found
 */
export async function getPersonalityName(
  userClient: UserClient,
  personalityId: string
): Promise<string | null> {
  const result = await getCachedPersonalities(userClient);
  if (result.kind === 'error') {
    return null;
  }

  const personality = result.value.find(p => p.id === personalityId);
  if (personality === undefined) {
    return null;
  }

  // Return displayName if set, otherwise name
  return personality.displayName ?? personality.name;
}
