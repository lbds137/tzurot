/**
 * LLM Config Command Group
 * Manage user LLM configurations
 *
 * Commands:
 * - /llm-config list - Show available configs
 * - /llm-config create - Create a new config
 * - /llm-config delete - Delete your config
 */

import { SlashCommandBuilder } from 'discord.js';
import { createLogger, DISCORD_PROVIDER_CHOICES } from '@tzurot/common-types';
import { createSubcommandRouter } from '../../utils/subcommandRouter.js';
import { handleList } from './list.js';
import { handleCreate } from './create.js';
import { handleDelete } from './delete.js';
import { handleAutocomplete } from './autocomplete.js';

const logger = createLogger('llm-config-command');

/**
 * Slash command definition
 */
export const data = new SlashCommandBuilder()
  .setName('llm-config')
  .setDescription('Manage your LLM configurations')
  .addSubcommand(subcommand =>
    subcommand.setName('list').setDescription('Show all available LLM configs')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('create')
      .setDescription('Create a new LLM config')
      .addStringOption(option =>
        option.setName('name').setDescription('Config name (unique to you)').setRequired(true)
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
      .setDescription('Delete one of your LLM configs')
      .addStringOption(option =>
        option
          .setName('config')
          .setDescription('Config ID to delete')
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
  { logger, logPrefix: '[LlmConfig]' }
);

/**
 * Autocomplete handler for config options
 */
export const autocomplete = handleAutocomplete;
