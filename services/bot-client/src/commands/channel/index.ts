/**
 * Channel Command Group
 * Manages channel activation for automatic personality responses
 *
 * Commands:
 * - /channel activate <personality> - Activate a personality in the current channel
 * - /channel deactivate - Deactivate the personality from the current channel
 * - /channel list - List all activated channels
 * - /channel settings - Open extended context settings dashboard
 */

import { SlashCommandBuilder } from 'discord.js';
import type {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { defineCommand } from '../../utils/defineCommand.js';
import { createSubcommandRouter } from '../../utils/subcommandRouter.js';
import { handleActivate } from './activate.js';
import { handleDeactivate } from './deactivate.js';
import { handleList } from './list.js';
import {
  handleContext,
  handleChannelContextSelectMenu,
  handleChannelContextButton,
  handleChannelContextModal,
  isChannelContextInteraction,
} from './settings.js';
import { handleAutocomplete } from './autocomplete.js';

const logger = createLogger('channel-command');

/**
 * Subcommand router for channel commands
 */
const channelRouter = createSubcommandRouter(
  {
    activate: handleActivate,
    deactivate: handleDeactivate,
    list: handleList,
    settings: handleContext,
  },
  { logger, logPrefix: '[Channel]' }
);

/**
 * Command execution router
 */
async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await channelRouter(interaction);
}

/**
 * Autocomplete handler
 */
async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await handleAutocomplete(interaction);
}

/**
 * Handle select menu interactions for channel commands
 */
async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  // Context dashboard interactions
  if (isChannelContextInteraction(interaction.customId)) {
    await handleChannelContextSelectMenu(interaction);
  }
}

/**
 * Handle button interactions for channel commands
 */
async function handleButton(interaction: ButtonInteraction): Promise<void> {
  // Context dashboard interactions
  if (isChannelContextInteraction(interaction.customId)) {
    await handleChannelContextButton(interaction);
  }
}

/**
 * Handle modal interactions for channel commands
 */
async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  // Context dashboard interactions
  if (isChannelContextInteraction(interaction.customId)) {
    await handleChannelContextModal(interaction);
  }
}

/**
 * Export command definition using defineCommand for type safety
 * Category is injected by CommandHandler based on folder structure
 */
export default defineCommand({
  data: new SlashCommandBuilder()
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
      subcommand
        .setName('deactivate')
        .setDescription('Deactivate the personality from this channel')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List activated channels in this server')
        .addBooleanOption(option =>
          option
            .setName('all')
            .setDescription('Show all servers (bot owner only)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('settings')
        .setDescription('Open extended context settings dashboard for this channel')
    ),
  execute,
  autocomplete,
  handleSelectMenu,
  handleButton,
  handleModal,
  componentPrefixes: ['channel-settings'],
});
