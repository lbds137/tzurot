/**
 * Me Command Autocomplete Handler
 * Provides autocomplete suggestions for personality and profile selection
 *
 * Uses gateway APIs for all data access (no direct Prisma).
 * Uses shared autocomplete utilities for DRY pattern across commands.
 */

import type { AutocompleteInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import {
  handlePersonalityAutocomplete,
  handlePersonaAutocomplete as sharedHandlePersonaAutocomplete,
  CREATE_NEW_PERSONA_VALUE,
} from '../../utils/autocomplete/index.js';

const logger = createLogger('me-autocomplete');

// Re-export for backwards compatibility with existing consumers
export { CREATE_NEW_PERSONA_VALUE };

/**
 * Handle personality autocomplete for /me override commands
 *
 * Uses the shared personality autocomplete utility with visibility indicators.
 */
export async function handleMePersonalityAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  try {
    const handled = await handlePersonalityAutocomplete(interaction, {
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
      '[Me] Personality autocomplete error'
    );
    await interaction.respond([]);
  }
}

/**
 * Handle profile (persona) autocomplete for /me commands
 * Lists user's profiles with option to create new
 *
 * Uses the shared persona autocomplete utility.
 *
 * @param interaction - Discord autocomplete interaction
 * @param includeCreateNew - Whether to include "Create new profile..." option
 */
export async function handlePersonaAutocomplete(
  interaction: AutocompleteInteraction,
  includeCreateNew = false
): Promise<void> {
  try {
    const handled = await sharedHandlePersonaAutocomplete(interaction, {
      optionName: 'profile',
      includeCreateNew,
      logPrefix: '[Me]',
    });

    if (!handled) {
      await interaction.respond([]);
    }
  } catch (error) {
    logger.error({ err: error, userId: interaction.user.id }, '[Me] Profile autocomplete error');
    await interaction.respond([]);
  }
}
