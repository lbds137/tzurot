/**
 * Character Command Autocomplete Handler
 * Provides autocomplete suggestions for character selection
 *
 * Uses the shared personality autocomplete utility for consistent behavior.
 */

import type { AutocompleteInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { handlePersonalityAutocomplete } from '../../utils/autocomplete/index.js';
import { runGuardedAutocomplete } from '../../utils/autocomplete/guardedAutocomplete.js';

const logger = createLogger('character-autocomplete');

/**
 * Handle autocomplete for /character commands
 *
 * - For 'edit', 'avatar', 'voice', 'voice-clear': only shows user-owned characters
 * - For 'view', 'chat', 'chime-in', etc.: shows all accessible characters (owned + public)
 *
 * Note: Delete is now handled via the edit dashboard, not a standalone command.
 */
export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand(false);

  await runGuardedAutocomplete(interaction, logger, async () => {
    // Determine if we should only show owned characters.
    // getSubcommand(false) returns string | null — null when focused option isn't in a subcommand.
    const ownedOnlySubcommands = ['edit', 'avatar', 'avatar-clear', 'voice', 'voice-clear'];
    const ownedOnly = subcommand !== null && ownedOnlySubcommands.includes(subcommand);

    const handled = await handlePersonalityAutocomplete(interaction, {
      optionName: 'character',
      ownedOnly,
      showVisibility: true,
    });

    if (!handled) {
      // Option wasn't 'character', return empty
      await interaction.respond([]);
    }
  });
}
