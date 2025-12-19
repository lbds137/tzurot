/**
 * Channel Command Group
 * Manages channel activation for automatic personality responses
 *
 * Commands:
 * - /channel activate <personality> - Activate a personality in the current channel
 * - /channel deactivate - Deactivate the personality from the current channel
 * - /channel list - List all activated channels
 */

import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { createSubcommandRouter } from '../../utils/subcommandRouter.js';
import { handleActivate } from './activate.js';
import { handleDeactivate } from './deactivate.js';
import { handleList } from './list.js';
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
    subcommand.setName('list').setDescription('List all channels with activated personalities')
  );

/**
 * Subcommand router for channel commands
 */
const channelRouter = createSubcommandRouter(
  {
    activate: handleActivate,
    deactivate: handleDeactivate,
    list: handleList,
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
