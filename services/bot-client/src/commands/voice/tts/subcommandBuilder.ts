/**
 * TTS subcommand group builder for /voice.
 *
 * Naming: browse / set / clear operate on PER-CHARACTER overrides; `default`
 * is your global default. Discord forbids a group inside a group, so `default`
 * carries both directions on one subcommand: provide the `tts` option to set
 * the default, omit it to clear the default.
 */

import type { SlashCommandSubcommandGroupBuilder } from 'discord.js';
import { SELECTOR_DESCRIPTION } from '@tzurot/common-types/constants/uxVocabulary';

export function buildVoiceTtsSubcommandGroup(
  group: SlashCommandSubcommandGroupBuilder
): SlashCommandSubcommandGroupBuilder {
  return group
    .setName('tts')
    .setDescription('Manage TTS configuration overrides')
    .addSubcommand(subcommand =>
      subcommand.setName('browse').setDescription('Browse your TTS overrides (select to clear)')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Override TTS config for a character')
        .addStringOption(option =>
          option
            .setName('character')
            .setDescription(SELECTOR_DESCRIPTION.character)
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option
            .setName('tts')
            .setDescription(SELECTOR_DESCRIPTION.ttsConfig)
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('clear')
        .setDescription('Clear the TTS override for a character')
        .addStringOption(option =>
          option
            .setName('character')
            .setDescription(SELECTOR_DESCRIPTION.character)
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('default')
        .setDescription('Set (or clear) your global default TTS config')
        .addStringOption(option =>
          option
            .setName('tts')
            .setDescription(`${SELECTOR_DESCRIPTION.ttsConfig} — leave empty to clear your default`)
            .setRequired(false)
            .setAutocomplete(true)
        )
    );
}
