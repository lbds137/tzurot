/**
 * History Command Autocomplete
 * Handles autocomplete for personality and persona selection
 *
 * Uses shared autocomplete utilities for consistency across commands.
 */

import type { AutocompleteInteraction } from 'discord.js';
import { handlePersonalityAutocomplete as sharedPersonalityAutocomplete } from '../../utils/autocomplete/personalityAutocomplete.js';
import { handlePersonaAutocomplete as sharedPersonaAutocomplete } from '../../utils/autocomplete/personaAutocomplete.js';

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
 * Handle persona autocomplete for the 'persona' option in history commands.
 * Shows user's personas for optional persona selection.
 */
export async function handlePersonaAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  await sharedPersonaAutocomplete(interaction, {
    optionName: 'persona',
    includeCreateNew: false,
    logPrefix: '[History]',
  });
}
