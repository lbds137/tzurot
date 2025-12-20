/**
 * Persona Autocomplete Utility
 *
 * Shared autocomplete handler for persona/profile selection across commands.
 * Used by /me profile commands, /history commands, etc.
 */

import type { AutocompleteInteraction } from 'discord.js';
import { createLogger, DISCORD_LIMITS } from '@tzurot/common-types';
import { getCachedPersonas } from './autocompleteCache.js';

const logger = createLogger('persona-autocomplete');

/**
 * Special value for "Create new profile" option in autocomplete
 */
export const CREATE_NEW_PERSONA_VALUE = '__create_new__';

/**
 * Options for persona autocomplete
 */
export interface PersonaAutocompleteOptions {
  /** Name of the option to check (default: 'profile') */
  optionName?: string;
  /** Whether to include "Create new profile..." option (default: false) */
  includeCreateNew?: boolean;
  /** Log prefix for debugging (default: '[Persona]') */
  logPrefix?: string;
}

/**
 * Handle persona autocomplete for any command
 * Lists user's personas/profiles with optional "create new" option
 *
 * Uses gateway API for data access.
 *
 * @param interaction - Discord autocomplete interaction
 * @param options - Autocomplete options
 * @returns true if handled, false if option name didn't match
 */
export async function handlePersonaAutocomplete(
  interaction: AutocompleteInteraction,
  options: PersonaAutocompleteOptions = {}
): Promise<boolean> {
  const { optionName = 'profile', includeCreateNew = false, logPrefix = '[Persona]' } = options;

  const focusedOption = interaction.options.getFocused(true);

  if (focusedOption.name !== optionName) {
    return false;
  }

  const query = focusedOption.value.toLowerCase();
  const userId = interaction.user.id;

  try {
    // Use cached data to avoid HTTP requests on every keystroke
    const personas = await getCachedPersonas(userId);

    // Filter by query
    const filtered = personas
      .filter(p => {
        if (query.length === 0) {
          return true;
        }
        return (
          p.name.toLowerCase().includes(query) ||
          (p.preferredName?.toLowerCase().includes(query) ?? false)
        );
      })
      // Leave room for "Create new" option if needed
      .slice(
        0,
        includeCreateNew
          ? DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES - 1
          : DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES
      );

    const choices: { name: string; value: string }[] = [];

    // Add user's personas
    for (const persona of filtered) {
      const displayName = persona.preferredName ?? persona.name;
      choices.push({
        name: persona.isDefault ? `${displayName} ⭐ (default)` : displayName,
        value: persona.id,
      });
    }

    // Add "Create new profile" option at the end if requested and query matches
    if (includeCreateNew) {
      const createNewLabel = '➕ Create new profile...';
      if (query === '' || createNewLabel.toLowerCase().includes(query)) {
        choices.push({
          name: createNewLabel,
          value: CREATE_NEW_PERSONA_VALUE,
        });
      }
    }

    await interaction.respond(choices);
    return true;
  } catch (error) {
    logger.error({ err: error, query, userId }, `${logPrefix} Autocomplete error`);
    await interaction.respond([]);
    return true;
  }
}
