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
    .setDescription('Choose who transcribes your voice messages')
    .addSubcommand(subcommand =>
      subcommand.setName('browse').setDescription('See your transcription preferences')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Pick who transcribes your voice messages for a specific personality')
        .addStringOption(option =>
          option
            .setName('personality')
            .setDescription('The personality')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option
            .setName('provider')
            .setDescription('Which provider to transcribe with')
            .setRequired(true)
            .addChoices(...PROVIDER_CHOICES)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('clear')
        .setDescription('Remove your transcription preference for a personality')
        .addStringOption(option =>
          option
            .setName('personality')
            .setDescription('The personality')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-default')
        .setDescription('Pick a default provider for transcribing your voice messages')
        .addStringOption(option =>
          option
            .setName('provider')
            .setDescription('Which provider to transcribe with')
            .setRequired(true)
            .addChoices(...PROVIDER_CHOICES)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('clear-default')
        .setDescription('Remove your default transcription provider')
    );
}
