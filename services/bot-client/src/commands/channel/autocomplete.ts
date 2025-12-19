/**
 * Channel Command Autocomplete Handler
 * Provides autocomplete suggestions for personality selection
 */

import type { AutocompleteInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { handlePersonalityAutocomplete } from '../../utils/autocomplete/index.js';

const logger = createLogger('channel-autocomplete');

/**
 * Handle autocomplete for /channel commands
 *
 * For 'activate': shows all accessible personalities (owned + public)
 */
export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand(false);

  try {
    const handled = await handlePersonalityAutocomplete(interaction, {
      optionName: 'personality',
      ownedOnly: false, // Channel activation can use any accessible personality
      showVisibility: true,
    });

    if (!handled) {
      // Option wasn't 'personality', return empty
      await interaction.respond([]);
    }
  } catch (error) {
    logger.error(
      {
        err: error,
        userId: interaction.user.id,
        guildId: interaction.guildId,
        command: interaction.commandName,
        subcommand,
      },
      '[Channel] Autocomplete error'
    );
    await interaction.respond([]);
  }
}
