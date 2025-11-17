/**
 * Personality Command Group
 * Commands for managing AI personalities
 *
 * This file is the main entry point - it exports the command definition
 * and routes execution to the appropriate handler.
 */

import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { getConfig, requireBotOwner } from '@tzurot/common-types';

// Import subcommand handlers
import { handleCreate } from './create.js';
import { handleEdit } from './edit.js';
import { handleImport } from './import.js';
import { handleCreateModal } from './create-modal.js';
import { handleModalSubmit } from './modal.js';

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

  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction, config);
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'create':
      await handleCreate(interaction, config);
      break;
    case 'edit':
      await handleEdit(interaction, config);
      break;
    case 'import':
      await handleImport(interaction, config);
      break;
    case 'create-modal':
      await handleCreateModal(interaction);
      break;
    default:
      await interaction.reply({
        content: '❌ Unknown subcommand',
        flags: MessageFlags.Ephemeral,
      });
  }
}
