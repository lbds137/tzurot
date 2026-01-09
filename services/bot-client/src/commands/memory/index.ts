/**
 * Memory Command
 * Manage long-term memories (LTM)
 *
 * Commands:
 * - /memory stats <personality> - View memory statistics
 * - /memory focus enable <personality> - Disable LTM retrieval
 * - /memory focus disable <personality> - Re-enable LTM retrieval
 * - /memory focus status <personality> - Check focus mode status
 */

import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { createSubcommandRouter } from '../../utils/subcommandRouter.js';
import { handleStats } from './stats.js';
import { handleFocusEnable, handleFocusDisable, handleFocusStatus } from './focus.js';
import { handlePersonalityAutocomplete } from './autocomplete.js';

const logger = createLogger('memory-command');

/**
 * Slash command definition
 */
export const data = new SlashCommandBuilder()
  .setName('memory')
  .setDescription('Manage your long-term memories')
  .addSubcommand(subcommand =>
    subcommand
      .setName('stats')
      .setDescription('View memory statistics')
      .addStringOption(option =>
        option
          .setName('personality')
          .setDescription('The personality to view stats for')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommandGroup(group =>
    group
      .setName('focus')
      .setDescription('Manage focus mode (disable LTM retrieval)')
      .addSubcommand(subcommand =>
        subcommand
          .setName('enable')
          .setDescription('Enable focus mode - stop retrieving long-term memories')
          .addStringOption(option =>
            option
              .setName('personality')
              .setDescription('The personality to enable focus mode for')
              .setRequired(true)
              .setAutocomplete(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('disable')
          .setDescription('Disable focus mode - resume retrieving long-term memories')
          .addStringOption(option =>
            option
              .setName('personality')
              .setDescription('The personality to disable focus mode for')
              .setRequired(true)
              .setAutocomplete(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('status')
          .setDescription('Check current focus mode status')
          .addStringOption(option =>
            option
              .setName('personality')
              .setDescription('The personality to check status for')
              .setRequired(true)
              .setAutocomplete(true)
          )
      )
  );

/**
 * Focus subcommand router
 */
const focusRouter = createSubcommandRouter(
  {
    enable: handleFocusEnable,
    disable: handleFocusDisable,
    status: handleFocusStatus,
  },
  { logger, logPrefix: '[Memory/Focus]' }
);

/**
 * Command execution router
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommandGroup = interaction.options.getSubcommandGroup();
  const subcommand = interaction.options.getSubcommand();

  if (subcommandGroup === 'focus') {
    await focusRouter(interaction);
  } else if (subcommand === 'stats') {
    await handleStats(interaction);
  } else {
    logger.warn({ subcommandGroup, subcommand }, '[Memory] Unknown subcommand');
  }
}

/**
 * Autocomplete handler for personality options
 */
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);

  if (focusedOption.name === 'personality') {
    await handlePersonalityAutocomplete(interaction);
  } else {
    await interaction.respond([]);
  }
}

/**
 * Category for this command
 */
export const category = 'Memory';
