/**
 * History Command Autocomplete
 * Handles autocomplete for personality and profile selection
 */

import type { AutocompleteInteraction } from 'discord.js';
import { createLogger, DISCORD_LIMITS } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { handlePersonaAutocomplete } from '../../utils/autocomplete/personaAutocomplete.js';

const logger = createLogger('history-autocomplete');

interface PersonalityOption {
  slug: string;
  name: string;
  displayName: string | null;
  isPublic: boolean;
  isOwner: boolean;
}

interface PersonalityListResponse {
  personalities: PersonalityOption[];
}

/**
 * Handle personality autocomplete for history commands
 * Shows all personalities the user can interact with (public + owned)
 */
export async function handlePersonalityAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const userId = interaction.user.id;
  const focusedValue = interaction.options.getFocused().toLowerCase();

  try {
    // Fetch personalities from gateway
    const result = await callGatewayApi<PersonalityListResponse>('/user/personality', {
      userId,
      method: 'GET',
    });

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, '[History] Failed to fetch personalities');
      await interaction.respond([]);
      return;
    }

    const { personalities } = result.data;

    // Filter by search term
    const filtered = personalities
      .filter(p => {
        const searchName = (p.displayName ?? p.name).toLowerCase();
        const searchSlug = p.slug.toLowerCase();
        return searchName.includes(focusedValue) || searchSlug.includes(focusedValue);
      })
      .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

    // Format choices
    const choices = filtered.map(p => {
      const displayName = p.displayName ?? p.name;
      // Add owner indicator if the user owns this personality
      const suffix = p.isOwner ? ' (yours)' : '';
      return {
        name: `${displayName}${suffix}`,
        value: p.slug,
      };
    });

    await interaction.respond(choices);
  } catch (error) {
    logger.error({ err: error, userId }, '[History] Autocomplete error');
    await interaction.respond([]);
  }
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
