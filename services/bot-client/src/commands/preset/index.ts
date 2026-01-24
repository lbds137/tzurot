/**
 * Preset Command Group
 * Manage user model presets and global presets (owner only)
 *
 * Commands:
 * - /preset browse - Browse presets with search and filtering
 * - /preset create - Create a new preset
 * - /preset edit - Edit your preset (opens dashboard, includes delete)
 * - /preset global create - Create global preset (owner only)
 * - /preset global default - Set system default (owner only)
 * - /preset global free-default - Set free tier default (owner only)
 *
 * Note: Global presets can be edited via /preset edit (dashboard handles both)
 * Note: Delete functionality is integrated into the dashboard (Edit command)
 */

import { SlashCommandBuilder } from 'discord.js';
import type {
  AutocompleteInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { createLogger, DISCORD_PROVIDER_CHOICES } from '@tzurot/common-types';
import { defineCommand } from '../../utils/defineCommand.js';
import { createTypedSubcommandRouter } from '../../utils/subcommandRouter.js';
import { createMixedModeSubcommandRouter } from '../../utils/mixedModeSubcommandRouter.js';
import type {
  DeferredCommandContext,
  SafeCommandContext,
} from '../../utils/commandContext/types.js';
import { requireBotOwnerContext } from '../../utils/commandContext/factories.js';
import {
  handleBrowse,
  handleBrowsePagination,
  isPresetBrowseInteraction,
  handleBrowseSelect,
  isPresetBrowseSelectInteraction,
} from './browse.js';
import { handleCreate } from './create.js';
import { handleEdit } from './edit.js';
import { handleAutocomplete } from './autocomplete.js';
import { handleGlobalCreate } from './global/create.js';
import { handleGlobalSetDefault } from './global/set-default.js';
import { handleGlobalSetFreeDefault } from './global/free-default.js';
import {
  handleModalSubmit,
  handleSelectMenu,
  handleButton,
  isPresetDashboardInteraction,
} from './dashboard.js';

const logger = createLogger('preset-command');

/**
 * Create user preset router with mixed deferral modes
 * - create: modal mode (shows seed modal)
 * - browse/edit: deferred mode (ephemeral response)
 * Note: Delete is now handled via the dashboard
 */
const userRouter = createMixedModeSubcommandRouter(
  {
    modal: { create: handleCreate },
    deferred: { browse: handleBrowse, edit: handleEdit },
  },
  { logger, logPrefix: '[Preset]' }
);

/**
 * Create global preset router (owner only)
 */
const globalRouter = createTypedSubcommandRouter(
  {
    create: handleGlobalCreate,
    default: handleGlobalSetDefault,
    'free-default': handleGlobalSetFreeDefault,
  },
  { logger, logPrefix: '[Preset/Global]' }
);

/**
 * Command execution router
 * Routes to appropriate handler based on subcommand and deferral mode
 */
async function execute(context: SafeCommandContext): Promise<void> {
  const group = context.getSubcommandGroup();

  if (group === 'global') {
    // Owner-only check for global subcommand group
    const deferredCtx = context as DeferredCommandContext;
    if (!(await requireBotOwnerContext(deferredCtx))) {
      return;
    }
    await globalRouter(deferredCtx);
  } else {
    // User preset commands - router handles modal vs deferred
    await userRouter(context);
  }
}

/**
 * Autocomplete handler for preset options
 */
async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await handleAutocomplete(interaction);
}

/**
 * Select menu interaction handler for preset dashboard and browse
 */
async function selectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  // Handle browse select - opens dashboard from browse list
  if (isPresetBrowseSelectInteraction(interaction.customId)) {
    await handleBrowseSelect(interaction);
    return;
  }

  // Handle dashboard select - edit sections
  if (isPresetDashboardInteraction(interaction.customId)) {
    await handleSelectMenu(interaction);
    return;
  }
}

/**
 * Button interaction handler for preset dashboard and browse pagination
 */
async function button(interaction: ButtonInteraction): Promise<void> {
  // Handle browse pagination
  if (isPresetBrowseInteraction(interaction.customId)) {
    await handleBrowsePagination(interaction);
    return;
  }

  // Handle dashboard buttons
  if (!isPresetDashboardInteraction(interaction.customId)) {
    return;
  }
  await handleButton(interaction);
}

/**
 * Modal interaction handler for preset dashboard
 */
async function modal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!isPresetDashboardInteraction(interaction.customId)) {
    return;
  }
  await handleModalSubmit(interaction);
}

/**
 * Export command definition using defineCommand for type safety
 * Category is injected by CommandHandler based on folder structure
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('preset')
    .setDescription('Manage your model presets')
    .addSubcommand(subcommand =>
      subcommand
        .setName('browse')
        .setDescription('Browse and search model presets')
        .addStringOption(option =>
          option.setName('query').setDescription('Search by name or model').setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName('filter')
            .setDescription('Filter presets by type')
            .setRequired(false)
            .addChoices(
              { name: 'All Presets', value: 'all' },
              { name: 'Global Only', value: 'global' },
              { name: 'My Presets', value: 'mine' },
              { name: 'Free Models', value: 'free' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('create').setDescription('Create a new model preset')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit')
        .setDescription('Edit one of your model presets')
        .addStringOption(option =>
          option
            .setName('preset')
            .setDescription('Preset to edit')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('global')
        .setDescription('Manage global presets (Owner only)')
        .addSubcommand(subcommand =>
          subcommand
            .setName('create')
            .setDescription('Create a new global preset (Owner only)')
            .addStringOption(option =>
              option.setName('name').setDescription('Preset name').setRequired(true)
            )
            .addStringOption(option =>
              option
                .setName('model')
                .setDescription('Model ID (e.g., anthropic/claude-sonnet-4)')
                .setRequired(true)
            )
            .addStringOption(option =>
              option
                .setName('provider')
                .setDescription('AI provider')
                .setRequired(false)
                .addChoices(...DISCORD_PROVIDER_CHOICES)
            )
            .addStringOption(option =>
              option
                .setName('description')
                .setDescription('Optional description')
                .setRequired(false)
            )
            .addStringOption(option =>
              option
                .setName('vision-model')
                .setDescription('Vision model (optional)')
                .setRequired(false)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('default')
            .setDescription('Set a global preset as the system default (Owner only)')
            .addStringOption(option =>
              option
                .setName('config')
                .setDescription('Global preset to set as default')
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('free-default')
            .setDescription('Set a global preset as the free tier default (Owner only)')
            .addStringOption(option =>
              option
                .setName('config')
                .setDescription('Global preset to set as free tier default')
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
    ),
  deferralMode: 'ephemeral',
  subcommandDeferralModes: {
    create: 'modal',
  },
  execute,
  autocomplete,
  handleSelectMenu: selectMenu,
  handleButton: button,
  handleModal: modal,
});
