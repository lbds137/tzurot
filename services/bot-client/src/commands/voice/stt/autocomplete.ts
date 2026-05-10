/**
 * Voice STT Autocomplete Handler
 *
 * STT subcommands take only `personality` (autocompleted) and `provider`
 * (static choices via SlashCommandBuilder.addChoices — no autocomplete
 * needed). So this handler only routes the personality option.
 */

import type { AutocompleteInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { handlePersonalityAutocomplete } from '../../../utils/autocomplete/index.js';

const logger = createLogger('voice-stt-autocomplete');

/** Handle autocomplete for /voice stt commands */
export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);

  try {
    if (focusedOption.name === 'personality') {
      await handlePersonalityAutocomplete(interaction, {
        optionName: 'personality',
        ownedOnly: false,
        showVisibility: true,
        valueField: 'id',
      });
    } else {
      await interaction.respond([]);
    }
  } catch (error) {
    logger.error(
      {
        err: error,
        option: focusedOption.name,
        query: focusedOption.value,
        userId: interaction.user.id,
      },
      'STT autocomplete error'
    );
    if (!interaction.responded) {
      await interaction.respond([]);
    }
  }
}
