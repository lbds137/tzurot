/**
 * Voices subcommand group builder for /voice.
 *
 * Cloned-voice lifecycle operations: browse, delete (one), clear (all).
 * Schema preserved verbatim from the legacy /settings voices group; only
 * the parent command moved (settings → voice).
 */

import type { SlashCommandSubcommandGroupBuilder } from 'discord.js';

export function buildVoiceVoicesSubcommandGroup(
  group: SlashCommandSubcommandGroupBuilder
): SlashCommandSubcommandGroupBuilder {
  return group
    .setName('voices')
    .setDescription('Manage your ElevenLabs cloned voices')
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
            .setDescription('The voice to delete')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('clear').setDescription('Delete all Tzurot cloned voices')
    );
}
