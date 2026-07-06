/**
 * Shared guard for command autocomplete handlers.
 *
 * Every command's `handleAutocomplete` wraps its option dispatch in the same
 * skeleton: try the dispatch, and on ANY error log the standard field set and
 * respond with an empty choice list (Discord renders that as "no suggestions"
 * — an autocomplete failure must never surface as a user-facing error). The
 * dispatch itself stays in the command file: which option names exist and
 * what each fetches is per-command business logic; only the guard is shared.
 */

import type { AutocompleteInteraction } from 'discord.js';
import type { createLogger } from '@tzurot/common-types/utils/logger';

type Logger = ReturnType<typeof createLogger>;

/**
 * Run a command's autocomplete dispatch inside the standard guard.
 *
 * The dispatch callback owns option routing and MUST respond on every path
 * it handles (including its own empty-respond fallback for unknown options);
 * the guard responds only on the error path.
 */
export async function runGuardedAutocomplete(
  interaction: AutocompleteInteraction,
  logger: Logger,
  dispatch: () => Promise<void>
): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);
  try {
    await dispatch();
  } catch (error) {
    logger.error(
      {
        err: error,
        option: focusedOption.name,
        query: focusedOption.value,
        userId: interaction.user.id,
        guildId: interaction.guildId,
        command: interaction.commandName,
        subcommand: interaction.options.getSubcommand(false),
      },
      'Autocomplete error'
    );
    await interaction.respond([]);
  }
}

/**
 * The character-option config shared by every command whose autocomplete
 * feeds a personality ID to an override/config API: any accessible
 * personality, visibility badges, id as the submitted value.
 */
export const CHARACTER_ID_AUTOCOMPLETE = {
  optionName: 'character',
  ownedOnly: false,
  showVisibility: true,
  valueField: 'id',
} as const;
