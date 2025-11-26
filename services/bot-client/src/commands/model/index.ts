/**
 * Model Command Group
 * Override which LLM config a personality uses
 *
 * Commands:
 * - /model list - Show your model overrides
 * - /model set - Override model for a personality
 * - /model reset - Remove override, use default
 */

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { handleListOverrides } from './list.js';
import { handleSet } from './set.js';
import { handleReset } from './reset.js';

const logger = createLogger('model-command');

/**
 * Slash command definition
 */
export const data = new SlashCommandBuilder()
  .setName('model')
  .setDescription('Override which model a personality uses')
  .addSubcommand(subcommand =>
    subcommand.setName('list').setDescription('Show your model overrides')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('set')
      .setDescription('Override model for a personality')
      .addStringOption(option =>
        option
          .setName('personality')
          .setDescription('Personality to override')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption(option =>
        option
          .setName('config')
          .setDescription('LLM config to use')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('reset')
      .setDescription('Remove model override, use default')
      .addStringOption(option =>
        option
          .setName('personality')
          .setDescription('Personality to reset')
          .setRequired(true)
          .setAutocomplete(true)
      )
  );

/**
 * Command execution router
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  logger.info({ subcommand, userId: interaction.user.id }, '[Model] Executing subcommand');

  switch (subcommand) {
    case 'list':
      await handleListOverrides(interaction);
      break;
    case 'set':
      await handleSet(interaction);
      break;
    case 'reset':
      await handleReset(interaction);
      break;
    default:
      await interaction.reply({
        content: '❌ Unknown subcommand',
        flags: MessageFlags.Ephemeral,
      });
  }
}
