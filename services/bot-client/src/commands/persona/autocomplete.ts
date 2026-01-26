/**
 * Persona Command Autocomplete Handler
 *
 * Provides autocomplete suggestions for personality and persona selection.
 * Uses shared autocomplete utilities for DRY pattern across commands.
 */

import type { AutocompleteInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import {
  handlePersonalityAutocomplete as sharedHandlePersonalityAutocomplete,
  handlePersonaAutocomplete as sharedHandlePersonaAutocomplete,
  CREATE_NEW_PERSONA_VALUE,
} from '../../utils/autocomplete/index.js';

const logger = createLogger('persona-autocomplete');

// Re-export for external consumers
export { CREATE_NEW_PERSONA_VALUE };

/**
 * Handle personality autocomplete for /persona override commands
 *
 * Uses the shared personality autocomplete utility with visibility indicators.
 */
export async function handlePersonalityAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  try {
    const handled = await sharedHandlePersonalityAutocomplete(interaction, {
      optionName: 'personality',
      ownedOnly: false, // Override can be set for any accessible personality
      showVisibility: true,
    });

    if (!handled) {
      await interaction.respond([]);
    }
  } catch (error) {
    logger.error(
      { err: error, userId: interaction.user.id },
      '[Persona] Personality autocomplete error'
    );
    await interaction.respond([]);
  }
}

/**
 * Handle persona autocomplete for /persona commands
 * Lists user's personas with option to create new
 *
 * Uses the shared persona autocomplete utility.
 *
 * @param interaction - Discord autocomplete interaction
 * @param includeCreateNew - Whether to include "Create new persona..." option
 */
export async function handlePersonaAutocomplete(
  interaction: AutocompleteInteraction,
  includeCreateNew = false
): Promise<void> {
  try {
    const handled = await sharedHandlePersonaAutocomplete(interaction, {
      optionName: 'persona', // Key difference from /me which uses 'profile'
      includeCreateNew,
      logPrefix: '[Persona]',
    });

    if (!handled) {
      await interaction.respond([]);
    }
  } catch (error) {
    logger.error({ err: error, userId: interaction.user.id }, '[Persona] Autocomplete error');
    await interaction.respond([]);
  }
}
