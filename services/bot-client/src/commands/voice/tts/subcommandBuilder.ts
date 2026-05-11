/**
 * TTS subcommand group builder for /voice.
 *
 * Symmetric naming: set / clear / set-default / clear-default / browse.
 * Each subcommand owns one (action × scope) pair. The shape mirrors what
 * /voice stt will adopt in PR 2 — sharing the pattern keeps both subgroups
 * predictable for users.
 *
 * Renamed from the legacy /settings tts shape:
 *   reset   → clear        (per-personality clear, action verb consistent with set)
 *   default → set-default  (global-default set, parallel verb prefix)
 */

import type { SlashCommandSubcommandGroupBuilder } from 'discord.js';

export function buildVoiceTtsSubcommandGroup(
  group: SlashCommandSubcommandGroupBuilder
): SlashCommandSubcommandGroupBuilder {
  return group
    .setName('tts')
    .setDescription('Manage TTS configuration overrides')
    .addSubcommand(subcommand =>
      subcommand.setName('list').setDescription('List your TTS overrides')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Override TTS config for a character')
        .addStringOption(option =>
          option
            .setName('character')
            .setDescription('The character to override')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option
            .setName('tts')
            .setDescription('The TTS config to use')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('clear')
        .setDescription('Remove TTS config override for a character')
        .addStringOption(option =>
          option
            .setName('character')
            .setDescription('The character to clear')
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
            .setDescription('The TTS config to use as default')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('clear-default').setDescription('Clear your global default TTS config')
    );
}
