/**
 * Preset Command Group
 * Manage user model presets
 *
 * Commands:
 * - /preset list - Show available presets
 * - /preset create - Create a new preset
 * - /preset delete - Delete your preset
 */

import { SlashCommandBuilder } from 'discord.js';
import { createLogger, DISCORD_PROVIDER_CHOICES } from '@tzurot/common-types';
import { createSubcommandRouter } from '../../utils/subcommandRouter.js';
import { handleList } from './list.js';
import { handleCreate } from './create.js';
import { handleDelete } from './delete.js';
import { handleAutocomplete } from './autocomplete.js';

const logger = createLogger('preset-command');

/**
 * Slash command definition
 */
export const data = new SlashCommandBuilder()
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
      .setName('delete')
      .setDescription('Delete one of your model presets')
      .addStringOption(option =>
        option
          .setName('preset')
          .setDescription('Preset to delete')
          .setRequired(true)
          .setAutocomplete(true)
      )
  );

/**
 * Command execution router
 */
export const execute = createSubcommandRouter(
  {
    list: handleList,
    create: handleCreate,
    delete: handleDelete,
  },
  { logger, logPrefix: '[Preset]' }
);

/**
 * Autocomplete handler for preset options
 */
export const autocomplete = handleAutocomplete;

/**
 * Category for this command
 */
export const category = 'Preset';
