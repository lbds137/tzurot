/**
 * Preset Command Group
 * Manage user model presets and global presets (owner only)
 *
 * Commands:
 * - /preset list - Show available presets
 * - /preset create - Create a new preset
 * - /preset edit - Edit your preset (opens dashboard)
 * - /preset delete - Delete your preset
 * - /preset global create - Create global preset (owner only)
 * - /preset global edit - Edit global preset (owner only)
 * - /preset global set-default - Set system default (owner only)
 * - /preset global set-free-default - Set free tier default (owner only)
 */

import { SlashCommandBuilder } from 'discord.js';
import type {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { createLogger, DISCORD_PROVIDER_CHOICES, requireBotOwner } from '@tzurot/common-types';
import { defineCommand } from '../../utils/defineCommand.js';
import { createSubcommandRouter } from '../../utils/subcommandRouter.js';
import { handleList } from './list.js';
import { handleCreate } from './create.js';
import { handleEdit } from './edit.js';
import { handleDelete } from './delete.js';
import { handleAutocomplete } from './autocomplete.js';
import { handleGlobalCreate } from './global/create.js';
import { handleGlobalEdit } from './global/edit.js';
import { handleGlobalSetDefault } from './global/set-default.js';
import { handleGlobalSetFreeDefault } from './global/set-free-default.js';
import {
  handleModalSubmit,
  handleSelectMenu,
  handleButton,
  isPresetDashboardInteraction,
} from './dashboard.js';

const logger = createLogger('preset-command');

/**
 * Create user preset router
 */
const userRouter = createSubcommandRouter(
  {
    list: handleList,
    create: handleCreate,
    edit: handleEdit,
    delete: handleDelete,
  },
  { logger, logPrefix: '[Preset]' }
);

/**
 * Create global preset router (owner only)
 */
const globalRouter = createSubcommandRouter(
  {
    create: handleGlobalCreate,
    edit: handleGlobalEdit,
    'set-default': handleGlobalSetDefault,
    'set-free-default': handleGlobalSetFreeDefault,
  },
  { logger, logPrefix: '[Preset/Global]' }
);

/**
 * Command execution router
 */
async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const group = interaction.options.getSubcommandGroup(false);

  if (group === 'global') {
    // Owner-only check for global subcommand group
    if (!(await requireBotOwner(interaction))) {
      return;
    }
    await globalRouter(interaction);
  } else {
    // User preset commands (no special permissions)
    await userRouter(interaction);
  }
}

/**
 * Autocomplete handler for preset options
 */
async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await handleAutocomplete(interaction);
}

/**
 * Select menu interaction handler for preset dashboard
 */
async function selectMenu(interaction: StringSelectMenuInteraction): Promise<boolean> {
  if (!isPresetDashboardInteraction(interaction.customId)) {
    return false;
  }
  await handleSelectMenu(interaction);
  return true;
}

/**
 * Button interaction handler for preset dashboard
 */
async function button(interaction: ButtonInteraction): Promise<boolean> {
  if (!isPresetDashboardInteraction(interaction.customId)) {
    return false;
  }
  await handleButton(interaction);
  return true;
}

/**
 * Modal interaction handler for preset dashboard
 */
async function modal(interaction: ModalSubmitInteraction): Promise<boolean> {
  if (!isPresetDashboardInteraction(interaction.customId)) {
    return false;
  }
  await handleModalSubmit(interaction);
  return true;
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
      subcommand.setName('list').setDescription('Show all available model presets')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Create a new model preset')
        .addStringOption(option =>
          option.setName('name').setDescription('Preset name (unique to you)').setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('model')
            .setDescription('Model ID (e.g., anthropic/claude-sonnet-4)')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option
            .setName('provider')
            .setDescription('AI provider')
            .setRequired(false)
            .addChoices(...DISCORD_PROVIDER_CHOICES)
        )
        .addStringOption(option =>
          option.setName('description').setDescription('Optional description').setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName('vision-model')
            .setDescription('Vision model for image analysis (optional)')
            .setRequired(false)
            .setAutocomplete(true)
        )
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
    .addSubcommand(subcommand =>
      subcommand
        .setName('delete')
        .setDescription('Delete one of your model presets')
        .addStringOption(option =>
          option
            .setName('preset')
            .setDescription('Preset to delete')
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
            .setName('edit')
            .setDescription('Edit a global preset via dashboard (Owner only)')
            .addStringOption(option =>
              option
                .setName('config')
                .setDescription('Global preset to edit')
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('set-default')
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
            .setName('set-free-default')
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
  execute,
  autocomplete,
  selectMenu,
  button,
  modal,
});
