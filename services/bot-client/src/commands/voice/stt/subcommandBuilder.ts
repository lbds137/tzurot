/**
 * STT subcommand group builder for /voice.
 *
 * Two subcommands: set / clear. STT is user-scoped (your voice doesn't
 * change per character) so there's no per-character dimension. When the
 * user has no preference set, transcription derives from their default
 * TTS provider (BYOK pairs like Mistral handle both audio directions),
 * otherwise falls back to the self-hosted voice-engine.
 */

import type { SlashCommandSubcommandGroupBuilder } from 'discord.js';
import {
  STT_PROVIDERS,
  sttProviderDisplayName,
  type SttProvider,
} from '@tzurot/common-types/types/sttProvider';

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
      subcommand
        .setName('set')
        .setDescription('Pick a provider to transcribe your voice messages')
        .addStringOption(option =>
          option
            .setName('provider')
            .setDescription('Which provider to transcribe with')
            .setRequired(true)
            .addChoices(...PROVIDER_CHOICES)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('clear').setDescription('Remove your transcription provider preference')
    );
}
