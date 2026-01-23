/**
 * Character Command Autocomplete Handler
 * Provides autocomplete suggestions for character selection
 *
 * Uses the shared personality autocomplete utility for consistent behavior.
 */

import type { AutocompleteInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { handlePersonalityAutocomplete } from '../../utils/autocomplete/index.js';

const logger = createLogger('character-autocomplete');

/**
 * Handle autocomplete for /character commands
 *
 * - For 'edit' and 'avatar': only shows user-owned characters
 * - For 'view', 'chat', etc.: shows all accessible characters (owned + public)
 *
 * Note: Delete is now handled via the edit dashboard, not a standalone command.
 */
export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand(false);

  try {
    // Determine if we should only show owned characters
    const ownedOnly = subcommand === 'edit' || subcommand === 'avatar';

    const handled = await handlePersonalityAutocomplete(interaction, {
      optionName: 'character',
      ownedOnly,
      showVisibility: true,
    });

    if (!handled) {
      // Option wasn't 'character', return empty
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
      '[Character] Autocomplete error'
    );
    await interaction.respond([]);
  }
}
