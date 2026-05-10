/**
 * Provider subcommand group builder for /voice.
 *
 * Two subcommands writing the foundational `User.defaultProvider` field —
 * Layer 4 of the STT cascade. Surgical TTS / STT overrides layer above
 * this baseline.
 */

import type { SlashCommandSubcommandGroupBuilder } from 'discord.js';
import { STT_PROVIDERS, sttProviderDisplayName, type SttProvider } from '@tzurot/common-types';

const PROVIDER_CHOICES = STT_PROVIDERS.map(p => ({
  name: sttProviderDisplayName(p),
  value: p,
})) as { name: string; value: SttProvider }[];

export function buildVoiceProviderSubcommandGroup(
  group: SlashCommandSubcommandGroupBuilder
): SlashCommandSubcommandGroupBuilder {
  return group
    .setName('provider')
    .setDescription('Manage your foundational voice provider default')
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Set your foundational voice provider (Layer 4 of the STT cascade)')
        .addStringOption(option =>
          option
            .setName('provider')
            .setDescription('Which voice provider to use as your baseline')
            .setRequired(true)
            .addChoices(...PROVIDER_CHOICES)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('clear').setDescription('Clear your foundational voice provider')
    );
}
