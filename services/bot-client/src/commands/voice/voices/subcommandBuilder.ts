/**
 * Voices subcommand group builder for /voice.
 *
 * Cloned-voice lifecycle operations: browse, delete (one), purge (all).
 * Schema preserved verbatim from the legacy /settings voices group; only
 * the parent command moved (settings → voice).
 */

import type { SlashCommandSubcommandGroupBuilder } from 'discord.js';
import { SELECTOR_DESCRIPTION } from '@tzurot/common-types/constants/uxVocabulary';

export function buildVoiceVoicesSubcommandGroup(
  group: SlashCommandSubcommandGroupBuilder
): SlashCommandSubcommandGroupBuilder {
  return group
    .setName('voices')
    .setDescription('Manage your cloned voices')
    .addSubcommand(subcommand =>
      subcommand.setName('browse').setDescription('Browse your cloned voices')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('delete')
        .setDescription('Delete a single cloned voice')
        .addStringOption(option =>
          option
            .setName('voice')
            .setDescription(SELECTOR_DESCRIPTION.voice)
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('purge').setDescription('Permanently delete ALL Tzurot cloned voices')
    );
}
