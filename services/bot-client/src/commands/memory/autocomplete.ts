/**
 * Memory Command Autocomplete
 * Handles autocomplete for personality selection and provides
 * helper functions for resolving personality IDs.
 */

import type { AutocompleteInteraction } from 'discord.js';
import { handlePersonalityAutocomplete as sharedPersonalityAutocomplete } from '../../utils/autocomplete/personalityAutocomplete.js';
import { getCachedPersonalities } from '../../utils/autocomplete/autocompleteCache.js';
import { type GatewayUser } from '../../utils/userGatewayClient.js';

/**
 * Handle personality autocomplete for memory commands
 * Uses the shared personality autocomplete utility for consistency
 */
export async function handlePersonalityAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  await sharedPersonalityAutocomplete(interaction, {
    optionName: 'personality',
    showVisibility: true,
    ownedOnly: false, // Show all accessible personalities
    valueField: 'slug', // Return slug as value (user-friendly)
  });
}

/**
 * Resolve a personality slug to its UUID
 * Uses the autocomplete cache for performance
 *
 * @param userId - Discord user ID (for cache lookup)
 * @param slugOrId - Personality slug or ID from user input
 * @returns Personality UUID or null if not found
 */
export async function resolvePersonalityId(
  user: GatewayUser,
  slugOrId: string
): Promise<string | null> {
  const result = await getCachedPersonalities(user);
  if (result.kind === 'error') {
    return null;
  }
  const personalities = result.value;

  // Try to find by slug first (most common case from autocomplete)
  const bySlug = personalities.find(p => p.slug === slugOrId);
  if (bySlug !== undefined) {
    return bySlug.id;
  }

  // Try to find by ID (in case user pasted an ID directly)
  const byId = personalities.find(p => p.id === slugOrId);
  if (byId !== undefined) {
    return byId.id;
  }

  // Try to find by name (fuzzy match for user convenience)
  const byName = personalities.find(p => p.name.toLowerCase() === slugOrId.toLowerCase());
  if (byName !== undefined) {
    return byName.id;
  }

  return null;
}

/**
 * Get a personality's display name by ID
 *
 * @param userId - Discord user ID (for cache lookup)
 * @param personalityId - Personality UUID
 * @returns Personality display name or null if not found
 */
export async function getPersonalityName(
  user: GatewayUser,
  personalityId: string
): Promise<string | null> {
  const result = await getCachedPersonalities(user);
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
