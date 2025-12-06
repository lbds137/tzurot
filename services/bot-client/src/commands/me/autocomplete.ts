/**
 * Me Command Autocomplete Handler
 * Provides autocomplete suggestions for personality and profile selection
 *
 * Uses gateway APIs for all data access (no direct Prisma).
 */

import type { AutocompleteInteraction } from 'discord.js';
import { createLogger, DISCORD_LIMITS } from '@tzurot/common-types';
import { handlePersonalityAutocomplete } from '../../utils/autocomplete/index.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';

const logger = createLogger('me-autocomplete');

/**
 * Special value for "Create new profile" option in autocomplete
 */
export const CREATE_NEW_PERSONA_VALUE = '__create_new__';

/**
 * Persona summary from gateway API
 */
interface PersonaSummary {
  id: string;
  name: string;
  preferredName: string | null;
  isDefault: boolean;
}

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
 * Uses gateway API for data access.
 *
 * @param interaction - Discord autocomplete interaction
 * @param includeCreateNew - Whether to include "Create new profile..." option
 */
export async function handlePersonaAutocomplete(
  interaction: AutocompleteInteraction,
  includeCreateNew = false
): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);

  if (focusedOption.name !== 'profile') {
    await interaction.respond([]);
    return;
  }

  const query = focusedOption.value.toLowerCase();
  const userId = interaction.user.id;

  try {
    const result = await callGatewayApi<{ personas: PersonaSummary[] }>('/user/persona', {
      userId,
    });

    if (!result.ok) {
      logger.warn(
        { userId, error: result.error },
        '[Me] Failed to fetch personas for autocomplete'
      );
      await interaction.respond([]);
      return;
    }

    // Filter by query
    const filtered = result.data.personas
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
  } catch (error) {
    logger.error({ err: error, query, userId }, '[Me] Profile autocomplete error');
    await interaction.respond([]);
  }
}
