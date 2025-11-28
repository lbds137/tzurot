/**
 * Personality Command Group
 * Commands for managing AI personalities
 *
 * This file is the main entry point - it exports the command definition
 * and routes execution to the appropriate handler.
 */

import { SlashCommandBuilder } from 'discord.js';
import type {
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  AutocompleteInteraction,
} from 'discord.js';
import { createLogger, getConfig, requireBotOwner, type EnvConfig } from '@tzurot/common-types';
import { createSubcommandRouter } from '../../utils/subcommandRouter.js';

// Import subcommand handlers
import { handleCreate } from './create.js';
import { handleEdit } from './edit.js';
import { handleImport } from './import.js';
import { handleCreateModal } from './create-modal.js';
import { handleModalSubmit } from './modal.js';
import { handleAutocomplete as personalityAutocomplete } from './autocomplete.js';

const logger = createLogger('personality-command');

/**
 * Slash command definition
 */
export const data = new SlashCommandBuilder()
  .setName('personality')
  .setDescription('Manage AI personalities')
  .addSubcommand(subcommand =>
    subcommand
      .setName('create')
      .setDescription('Create a new AI personality')
      .addStringOption(option =>
        option.setName('name').setDescription('Display name of the personality').setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('slug')
          .setDescription('Unique identifier (lowercase, hyphens only)')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('character-info')
          .setDescription('Character background and description')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('personality-traits')
          .setDescription('Key personality traits and behaviors')
          .setRequired(true)
      )
      .addAttachmentOption(option =>
        option
          .setName('avatar')
          .setDescription('Profile picture (will be resized to 256x256, max 200KB)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('display-name')
          .setDescription('Display name (different from internal name if desired)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('tone')
          .setDescription('Conversational tone (e.g., friendly, professional, sarcastic)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('age').setDescription('Apparent age').setRequired(false)
      )
      .addStringOption(option =>
        option.setName('likes').setDescription('Things this personality likes').setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('dislikes')
          .setDescription('Things this personality dislikes')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('edit')
      .setDescription('Edit an existing AI personality')
      .addStringOption(option =>
        option
          .setName('slug')
          .setDescription('Unique identifier of the personality to edit')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption(option =>
        option.setName('name').setDescription('Display name of the personality').setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('character-info')
          .setDescription('Character background and description')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('personality-traits')
          .setDescription('Key personality traits and behaviors')
          .setRequired(false)
      )
      .addAttachmentOption(option =>
        option
          .setName('avatar')
          .setDescription('New profile picture (will be resized to 256x256, max 200KB)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('display-name')
          .setDescription('Display name (different from internal name if desired)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('tone')
          .setDescription('Conversational tone (e.g., friendly, professional, sarcastic)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('age').setDescription('Apparent age').setRequired(false)
      )
      .addStringOption(option =>
        option.setName('likes').setDescription('Things this personality likes').setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('dislikes')
          .setDescription('Things this personality dislikes')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('import')
      .setDescription('Import a personality from JSON file')
      .addAttachmentOption(option =>
        option
          .setName('file')
          .setDescription('JSON file containing personality data')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('create-modal')
      .setDescription('Create a new AI personality using an interactive form')
  );

/**
 * Create personality router with config dependency
 */
function createPersonalityRouter(
  config: EnvConfig
): (interaction: ChatInputCommandInteraction) => Promise<void> {
  return createSubcommandRouter(
    {
      create: interaction => handleCreate(interaction, config),
      edit: interaction => handleEdit(interaction, config),
      import: interaction => handleImport(interaction, config),
      'create-modal': handleCreateModal,
    },
    { logger, logPrefix: '[Personality]' }
  );
}

/**
 * Command execution router
 * Routes to the appropriate subcommand handler
 */
export async function execute(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction
): Promise<void> {
  // Owner-only check
  if (!(await requireBotOwner(interaction))) {
    return;
  }

  const config = getConfig();

  // Handle modal submissions separately
  if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction, config);
    return;
  }

  const router = createPersonalityRouter(config);
  await router(interaction);
}

/**
 * Autocomplete handler for personality commands
 */
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await personalityAutocomplete(interaction);
}
