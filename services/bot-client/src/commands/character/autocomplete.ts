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
 * - For 'edit' and the 'avatar'/'voice' groups: only shows user-owned characters
 * - For 'view', 'chime-in', etc.: shows all accessible characters (owned + public)
 *
 * Note: Delete is now handled via the edit dashboard, not a standalone command.
 */
export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand(false);
  const group = interaction.options.getSubcommandGroup(false);

  await runGuardedAutocomplete(interaction, logger, async () => {
    // Determine if we should only show owned characters. Media management
    // (the 'avatar'/'voice' groups) and 'edit' are owner-only writes.
    // The alias GROUP's subcommands ('browse', 'add') are deliberately NOT
    // here: aliases are visibility-scoped (anyone may add a personal alias
    // to any character they can see), so its autocomplete shows all
    // accessible characters.
    const ownedOnly = subcommand === 'edit' || group === 'avatar' || group === 'voice';

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
