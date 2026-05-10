/**
 * STT subcommand group builder for /voice.
 *
 * Mirrors {@link buildVoiceTtsSubcommandGroup} (set / clear / set-default /
 * clear-default / browse). Provider value is a string enum rather than a
 * config UUID, so it uses Discord's choices API instead of autocomplete.
 */

import type { SlashCommandSubcommandGroupBuilder } from 'discord.js';
import { STT_PROVIDERS, sttProviderDisplayName, type SttProvider } from '@tzurot/common-types';

const PROVIDER_CHOICES = STT_PROVIDERS.map(p => ({
  name: sttProviderDisplayName(p),
  value: p,
})) as { name: string; value: SttProvider }[];

export function buildVoiceSttSubcommandGroup(
  group: SlashCommandSubcommandGroupBuilder
): SlashCommandSubcommandGroupBuilder {
  return group
    .setName('stt')
    .setDescription('Manage speech-to-text provider overrides')
    .addSubcommand(subcommand =>
      subcommand.setName('browse').setDescription('Browse your STT provider overrides')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Override STT provider for a personality')
        .addStringOption(option =>
          option
            .setName('personality')
            .setDescription('The personality to override')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option
            .setName('provider')
            .setDescription('Which STT backend to use for this personality')
            .setRequired(true)
            .addChoices(...PROVIDER_CHOICES)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('clear')
        .setDescription('Remove STT provider override for a personality')
        .addStringOption(option =>
          option
            .setName('personality')
            .setDescription('The personality to clear')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-default')
        .setDescription('Set your global default STT provider')
        .addStringOption(option =>
          option
            .setName('provider')
            .setDescription('Which STT backend to use as your default')
            .setRequired(true)
            .addChoices(...PROVIDER_CHOICES)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('clear-default').setDescription('Clear your global default STT provider')
    );
}
