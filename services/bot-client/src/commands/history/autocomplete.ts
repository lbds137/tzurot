/**
 * History Command Autocomplete
 * Handles autocomplete for personality and profile selection
 *
 * Uses shared autocomplete utilities for consistency across commands.
 */

import type { AutocompleteInteraction } from 'discord.js';
import { handlePersonalityAutocomplete as sharedPersonalityAutocomplete } from '../../utils/autocomplete/personalityAutocomplete.js';
import { handlePersonaAutocomplete } from '../../utils/autocomplete/personaAutocomplete.js';

/**
 * Handle personality autocomplete for history commands
 * Uses the shared personality autocomplete utility for consistency
 */
export async function handlePersonalityAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  await sharedPersonalityAutocomplete(interaction, {
    optionName: 'personality',
    showVisibility: true,
    ownedOnly: false, // Show all accessible personalities (public + owned)
  });
}

/**
 * Handle profile autocomplete for history commands
 * Shows user's personas for optional profile selection
 */
export async function handleProfileAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  await handlePersonaAutocomplete(interaction, {
    optionName: 'profile',
    includeCreateNew: false,
    logPrefix: '[History]',
  });
}
