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
        option
          .setName('action')
          .setDescription('Action to perform')
          .setRequired(true)
          .addChoices(
            { name: 'Status - Show current settings', value: 'status' },
            { name: 'Enable - Force ON (always fetch channel history)', value: 'enable' },
            { name: 'Disable - Force OFF (never fetch channel history)', value: 'disable' },
            { name: 'Auto - Follow global default', value: 'auto' },
            { name: 'Set max messages (1-100)', value: 'set-max-messages' },
            { name: 'Set max age (e.g., 2h, off)', value: 'set-max-age' },
            { name: 'Set max images (0-20)', value: 'set-max-images' }
          )
      )
      .addIntegerOption(option =>
        option
          .setName('value')
          .setDescription('Value for set-max-messages or set-max-images')
          .setRequired(false)
          .setMinValue(0)
          .setMaxValue(100)
      )
      .addStringOption(option =>
        option
          .setName('duration')
          .setDescription('Duration for set-max-age (e.g., 2h, 30m, 1d, off, auto)')
          .setRequired(false)
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
