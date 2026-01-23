/**
 * Channel Command Group
 * Manages channel activation for automatic personality responses
 *
 * Commands:
 * - /channel activate <personality> - Activate a personality in the current channel
 * - /channel deactivate - Deactivate the personality from the current channel
 * - /channel browse - Browse activated channels with search and filtering
 * - /channel settings - Open extended context settings dashboard
 *
 * This command uses deferralMode: 'ephemeral' which means:
 * - The framework calls deferReply({ ephemeral: true }) before execute()
 * - The execute function receives a DeferredCommandContext (no deferReply method!)
 * - TypeScript prevents accidental deferReply() calls at compile time
 */

import { SlashCommandBuilder } from 'discord.js';
import type {
  AutocompleteInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import {
  defineCommand,
  type DeferredCommandContext,
  type SafeCommandContext,
} from '../../utils/defineCommand.js';
import { createSubcommandContextRouter } from '../../utils/subcommandContextRouter.js';
import { handleActivate } from './activate.js';
import { handleDeactivate } from './deactivate.js';
import { handleBrowse, handleBrowsePagination, isChannelBrowseInteraction } from './browse.js';
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
 * Context-aware subcommand router for channel commands.
 * All handlers receive DeferredCommandContext (no deferReply method).
 */
const channelRouter = createSubcommandContextRouter(
  {
    activate: handleActivate,
    deactivate: handleDeactivate,
    browse: handleBrowse,
    settings: handleContext,
  },
  { logger, logPrefix: '[Channel]' }
);

/**
 * Command execution - receives SafeCommandContext due to deferralMode.
 *
 * Note: The function signature uses SafeCommandContext for TypeScript compatibility,
 * but the runtime value is always DeferredCommandContext when deferralMode is 'ephemeral'.
 */
async function execute(ctx: SafeCommandContext): Promise<void> {
  const context = ctx as DeferredCommandContext;
  await channelRouter(context);
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
  // Handle browse pagination
  if (isChannelBrowseInteraction(interaction.customId)) {
    await handleBrowsePagination(interaction, interaction.guildId);
    return;
  }

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
 *
 * deferralMode: 'ephemeral' means:
 * - Framework calls deferReply({ ephemeral: true }) before execute()
 * - Execute receives DeferredCommandContext (no deferReply method)
 * - Compile-time prevention of InteractionAlreadyReplied errors
 */
export default defineCommand({
  deferralMode: 'ephemeral',
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
        .setName('browse')
        .setDescription('Browse activated channels')
        .addStringOption(option =>
          option.setName('query').setDescription('Search by personality name').setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName('filter')
            .setDescription('Filter channels by scope')
            .setRequired(false)
            .addChoices(
              { name: 'This Server', value: 'current' },
              { name: 'All Servers (Owner only)', value: 'all' }
            )
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
