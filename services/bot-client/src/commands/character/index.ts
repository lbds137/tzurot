/**
 * Character Command Group
 * Commands for managing AI characters (personalities)
 *
 * Uses the Dashboard pattern:
 * 1. /character create → Seed modal for minimal creation
 * 2. Dashboard embed shows character with edit menu
 * 3. Select menu → Section-specific modals with pre-filled values
 * 4. On submit → Dashboard refreshes with updated data
 */

import { SlashCommandBuilder } from 'discord.js';
import type {
  ModalSubmitInteraction,
  AutocompleteInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
} from 'discord.js';
import { createLogger, getConfig } from '@tzurot/common-types';
import { defineCommand } from '../../utils/defineCommand.js';
import type {
  SafeCommandContext,
  DeferredCommandContext,
} from '../../utils/commandContext/types.js';
import { createMixedModeSubcommandRouter } from '../../utils/mixedModeSubcommandRouter.js';

// Import handlers from split modules
import { handleAutocomplete } from './autocomplete.js';
import { handleImport } from './import.js';
import { handleExport } from './export.js';
import { handleTemplate } from './template.js';
import { handleView } from './view.js';
import { handleCreate } from './create.js';
import { handleEdit } from './edit.js';
import { handleAvatar } from './avatar.js';
import { handleBrowse, handleBrowsePagination, isCharacterBrowseInteraction } from './browse.js';
import { handleChat } from './chat.js';
import {
  handleSettings,
  handleCharacterSettingsSelectMenu,
  handleCharacterSettingsButton,
  handleCharacterSettingsModal,
  isCharacterSettingsInteraction,
} from './settings.js';
import {
  handleModalSubmit,
  handleSelectMenu as handleDashboardSelectMenu,
  handleButton as handleDashboardButton,
} from './dashboard.js';

const logger = createLogger('character-command');

/**
 * Create character router with mixed deferral modes
 *
 * - 'create' shows a modal (receives ModalCommandContext)
 * - All other subcommands are deferred (receive DeferredCommandContext)
 *
 * Handlers that need config get it via getConfig() internally or via wrapper.
 */
function createCharacterRouter(): (context: SafeCommandContext) => Promise<void> {
  const config = getConfig();

  return createMixedModeSubcommandRouter(
    {
      modal: {
        create: handleCreate,
      },
      deferred: {
        edit: (ctx: DeferredCommandContext) => handleEdit(ctx, config),
        view: (ctx: DeferredCommandContext) => handleView(ctx, config),
        browse: (ctx: DeferredCommandContext) => handleBrowse(ctx, config),
        avatar: (ctx: DeferredCommandContext) => handleAvatar(ctx, config),
        import: (ctx: DeferredCommandContext) => handleImport(ctx, config),
        export: (ctx: DeferredCommandContext) => handleExport(ctx, config),
        template: (ctx: DeferredCommandContext) => handleTemplate(ctx, config),
        chat: (ctx: DeferredCommandContext) => handleChat(ctx, config),
        settings: (ctx: DeferredCommandContext) => handleSettings(ctx, config),
      },
    },
    { logger, logPrefix: '[Character]' }
  );
}

/**
 * Command execution router
 */
async function execute(context: SafeCommandContext): Promise<void> {
  const router = createCharacterRouter();
  await router(context);
}

/**
 * Autocomplete handler
 */
async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await handleAutocomplete(interaction);
}

/**
 * Handle select menu interactions for character commands
 * Routes to settings dashboard or edit dashboard based on customId prefix
 */
async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  // Check if it's a settings dashboard interaction
  if (isCharacterSettingsInteraction(interaction.customId)) {
    await handleCharacterSettingsSelectMenu(interaction);
    return;
  }
  // Otherwise route to character edit dashboard
  await handleDashboardSelectMenu(interaction);
}

/**
 * Handle button interactions for character commands
 * Routes to browse pagination, settings dashboard, or edit dashboard based on customId
 */
async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const config = getConfig();

  // Handle browse pagination
  if (isCharacterBrowseInteraction(interaction.customId)) {
    await handleBrowsePagination(interaction, config);
    return;
  }

  // Check if it's a settings dashboard interaction
  if (isCharacterSettingsInteraction(interaction.customId)) {
    await handleCharacterSettingsButton(interaction);
    return;
  }

  // Otherwise route to character edit dashboard
  await handleDashboardButton(interaction);
}

/**
 * Handle modal interactions for character commands
 * Routes to settings dashboard or edit dashboard based on customId prefix
 */
async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  const config = getConfig();

  // Check if it's a settings dashboard modal
  if (isCharacterSettingsInteraction(interaction.customId)) {
    await handleCharacterSettingsModal(interaction);
    return;
  }

  // Otherwise route to character edit dashboard
  await handleModalSubmit(interaction, config);
}

/**
 * Export command definition using defineCommand for type safety
 * Category is injected by CommandHandler based on folder structure
 *
 * Uses mixed deferral modes:
 * - Most subcommands use ephemeral deferral
 * - 'create' shows a modal (no deferral)
 */
export default defineCommand({
  deferralMode: 'ephemeral', // Default for most subcommands
  subcommandDeferralModes: {
    create: 'modal', // /character create shows a modal
    chat: 'public', // /character chat is visible to everyone
  },
  data: new SlashCommandBuilder()
    .setName('character')
    .setDescription('Manage AI characters')
    .addSubcommand(subcommand =>
      subcommand.setName('create').setDescription('Create a new AI character')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit')
        .setDescription('Edit an existing AI character')
        .addStringOption(option =>
          option
            .setName('character')
            .setDescription('Character to edit')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View character details')
        .addStringOption(option =>
          option
            .setName('character')
            .setDescription('Character to view')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('browse')
        .setDescription('Browse and search characters')
        .addStringOption(option =>
          option.setName('query').setDescription('Search by name or description').setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName('filter')
            .setDescription('Filter characters by type')
            .setRequired(false)
            .addChoices(
              { name: 'All Characters', value: 'all' },
              { name: 'My Characters', value: 'mine' },
              { name: 'Public Only', value: 'public' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('avatar')
        .setDescription('Upload or change a character avatar')
        .addStringOption(option =>
          option
            .setName('character')
            .setDescription('Character to update')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addAttachmentOption(option =>
          option
            .setName('image')
            .setDescription('Avatar image (PNG, JPG, GIF, WebP)')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('import')
        .setDescription('Import a character from JSON file')
        .addAttachmentOption(option =>
          option
            .setName('file')
            .setDescription('JSON file containing character data')
            .setRequired(true)
        )
        .addAttachmentOption(option =>
          option
            .setName('avatar')
            .setDescription('Optional avatar image (PNG, JPG, GIF, WebP)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('export')
        .setDescription('Export a character as JSON file')
        .addStringOption(option =>
          option
            .setName('character')
            .setDescription('Character to export')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('template').setDescription('Show the JSON template for character import')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('chat')
        .setDescription('Send a message to a character, or summon them to weigh in')
        .addStringOption(option =>
          option
            .setName('character')
            .setDescription('Character to chat with')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option
            .setName('message')
            .setDescription(
              'Message to send (leave empty to have them weigh in on the conversation)'
            )
            .setRequired(false)
            .setMaxLength(2000)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('settings')
        .setDescription('Open character settings dashboard (owner only)')
        .addStringOption(option =>
          option
            .setName('character')
            .setDescription('Character to manage')
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),
  execute,
  autocomplete,
  handleSelectMenu,
  handleButton,
  handleModal,
  componentPrefixes: ['character-settings'],
});
