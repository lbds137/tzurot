/**
 * TTS subcommand group builder for /settings.
 *
 * Extracted from settings/index.ts to keep that file under the ESLint
 * max-lines limit. The handler routing still lives in settings/index.ts
 * — only the slash-command schema is here.
 */

import type { SlashCommandSubcommandGroupBuilder } from 'discord.js';

/**
 * Add TTS subcommands (browse, set, reset, default, clear-default) to the
 * given subcommand group builder. Mirrors the preset subcommand shape
 * (commands/settings/index.ts /settings preset block).
 */
export function buildTtsSubcommandGroup(
  group: SlashCommandSubcommandGroupBuilder
): SlashCommandSubcommandGroupBuilder {
  return group
    .setName('tts')
    .setDescription('Manage TTS configuration overrides')
    .addSubcommand(subcommand =>
      subcommand.setName('browse').setDescription('Browse available TTS configs')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Override TTS config for a personality')
        .addStringOption(option =>
          option
            .setName('personality')
            .setDescription('The personality to override')
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
        .setName('reset')
        .setDescription('Remove TTS config override for a personality')
        .addStringOption(option =>
          option
            .setName('personality')
            .setDescription('The personality to reset')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('default')
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
