/**
 * Channel Command Autocomplete Handler
 * Provides autocomplete suggestions for personality selection
 */

import type { AutocompleteInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { handlePersonalityAutocomplete } from '../../utils/autocomplete/index.js';
import { runGuardedAutocomplete } from '../../utils/autocomplete/guardedAutocomplete.js';

const logger = createLogger('channel-autocomplete');

/**
 * Handle autocomplete for /channel commands
 *
 * For 'activate': shows all accessible personalities (owned + public)
 */
export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await runGuardedAutocomplete(interaction, logger, async () => {
    const handled = await handlePersonalityAutocomplete(interaction, {
      optionName: 'character',
      ownedOnly: false, // Channel activation can use any accessible personality
      showVisibility: true,
    });

    if (!handled) {
      // Option wasn't 'character', return empty
      await interaction.respond([]);
    }
  });
}
