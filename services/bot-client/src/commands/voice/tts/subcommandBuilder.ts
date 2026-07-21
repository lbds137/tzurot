/**
 * TTS subcommand group builder for /voice.
 *
 * Symmetric naming: browse / set / clear / set-default / clear-default.
 * Each subcommand owns one (action × scope) pair. The shape mirrors what
 * /voice stt will adopt in PR 2 — sharing the pattern keeps both subgroups
 * predictable for users.
 *
 * Renamed from the legacy /settings tts shape:
 *   reset   → clear        (per-character clear, action verb consistent with set)
 *   default → set-default  (global-default set, parallel verb prefix)
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
        .setName('set-default')
        .setDescription('Set your global default TTS config')
        .addStringOption(option =>
          option
            .setName('tts')
            .setDescription(SELECTOR_DESCRIPTION.ttsConfig)
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('clear-default').setDescription('Clear your global default TTS config')
    );
}
