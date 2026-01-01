/**
 * Channel Command Group
 * Manages channel activation for automatic personality responses
 *
 * Commands:
 * - /channel activate <personality> - Activate a personality in the current channel
 * - /channel deactivate - Deactivate the personality from the current channel
 * - /channel list - List all activated channels
 * - /channel context <action> - Manage extended context settings
 */

import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { createSubcommandRouter } from '../../utils/subcommandRouter.js';
import { handleActivate } from './activate.js';
import { handleDeactivate } from './deactivate.js';
import { handleList } from './list.js';
import { handleContext } from './context.js';
import { handleAutocomplete } from './autocomplete.js';

const logger = createLogger('channel-command');

/**
 * Slash command definition
 */
export const data = new SlashCommandBuilder()
  .setName('channel')
  .setDescription('Manage automatic personality responses in channels')
  .addSubcommand(subcommand =>
    subcommand
      .setName('activate')
      .setDescription('Activate a personality to auto-respond in this channel')
      .addStringOption(option =>
        option
          .setName('personality')
          .setDescription('The personality to activate')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand.setName('deactivate').setDescription('Deactivate the personality from this channel')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('list')
      .setDescription('List activated channels in this server')
      .addBooleanOption(option =>
        option.setName('all').setDescription('Show all servers (bot owner only)').setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('context')
      .setDescription('Manage extended context settings for this channel')
      .addStringOption(option =>
        option.setName('action').setDescription('Action to perform').setRequired(true).addChoices(
          {
            name: 'Enable - Allow personalities to see recent channel messages',
            value: 'enable',
          },
          { name: 'Disable - Only use bot conversation history', value: 'disable' },
          { name: 'Status - Show current setting', value: 'status' },
          { name: 'Clear - Remove override, use global default', value: 'clear' }
        )
      )
  );

/**
 * Subcommand router for channel commands
 */
const channelRouter = createSubcommandRouter(
  {
    activate: handleActivate,
    deactivate: handleDeactivate,
    list: handleList,
    context: handleContext,
  },
  { logger, logPrefix: '[Channel]' }
);

/**
 * Command execution router
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await channelRouter(interaction);
}

/**
 * Autocomplete handler
 */
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await handleAutocomplete(interaction);
}
