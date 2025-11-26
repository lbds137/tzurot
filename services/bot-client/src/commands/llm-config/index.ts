/**
 * LLM Config Command Group
 * Manage user LLM configurations
 *
 * Commands:
 * - /llm-config list - Show available configs
 * - /llm-config create - Create a new config
 * - /llm-config delete - Delete your config
 */

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { handleList } from './list.js';
import { handleCreate } from './create.js';
import { handleDelete } from './delete.js';

const logger = createLogger('llm-config-command');

/**
 * Provider choices for config creation
 */
const PROVIDER_CHOICES = [
  { name: 'OpenRouter (recommended)', value: 'openrouter' },
  { name: 'Gemini', value: 'gemini' },
] as const;

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
      )
      .addStringOption(option =>
        option
          .setName('provider')
          .setDescription('AI provider')
          .setRequired(false)
          .addChoices(...PROVIDER_CHOICES)
      )
      .addStringOption(option =>
        option.setName('description').setDescription('Optional description').setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('vision-model')
          .setDescription('Vision model for image analysis (optional)')
          .setRequired(false)
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
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  logger.info({ subcommand, userId: interaction.user.id }, '[LlmConfig] Executing subcommand');

  switch (subcommand) {
    case 'list':
      await handleList(interaction);
      break;
    case 'create':
      await handleCreate(interaction);
      break;
    case 'delete':
      await handleDelete(interaction);
      break;
    default:
      await interaction.reply({
        content: '❌ Unknown subcommand',
        flags: MessageFlags.Ephemeral,
      });
  }
}
