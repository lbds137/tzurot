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
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { createLogger, getConfig, type EnvConfig } from '@tzurot/common-types';
import { createSubcommandRouter } from '../../utils/subcommandRouter.js';

// Import handlers from split modules
import { handleAutocomplete } from './autocomplete.js';
import { handleImport } from './import.js';
import { handleExport } from './export.js';
import { handleTemplate } from './template.js';
import { handleView } from './view.js';
import { handleCreate } from './create.js';
import { handleEdit } from './edit.js';
import { handleDelete } from './delete.js';
import { handleAvatar } from './avatar.js';
import { handleList } from './list.js';
import { handleChat } from './chat.js';
import {
  handleModalSubmit,
  handleSelectMenu,
  handleButton,
  isCharacterDashboardInteraction,
} from './dashboard.js';

const logger = createLogger('character-command');

// Re-export for external use
export { escapeMarkdown } from '../../utils/markdownUtils.js';
export { handleSelectMenu, handleButton, isCharacterDashboardInteraction };

/**
 * Slash command definition
 */
export const data = new SlashCommandBuilder()
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
      .setName('delete')
      .setDescription('Permanently delete a character and all its data')
      .addStringOption(option =>
        option
          .setName('character')
          .setDescription('Character to delete')
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
  .addSubcommand(subcommand => subcommand.setName('list').setDescription('List your characters'))
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
      .setDescription('Send a message to a character using a slash command')
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
          .setDescription('Message to send')
          .setRequired(true)
          .setMaxLength(2000)
      )
  );

/**
 * Create character router with config dependency
 */
function createCharacterRouter(
  config: EnvConfig
): (interaction: ChatInputCommandInteraction) => Promise<void> {
  return createSubcommandRouter(
    {
      create: handleCreate,
      edit: interaction => handleEdit(interaction, config),
      delete: interaction => handleDelete(interaction, config),
      view: interaction => handleView(interaction, config),
      list: interaction => handleList(interaction, config),
      avatar: interaction => handleAvatar(interaction, config),
      import: interaction => handleImport(interaction, config),
      export: interaction => handleExport(interaction, config),
      template: interaction => handleTemplate(interaction, config),
      chat: interaction => handleChat(interaction, config),
    },
    { logger, logPrefix: '[Character]' }
  );
}

/**
 * Command execution router
 */
export async function execute(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction
): Promise<void> {
  const config = getConfig();

  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction, config);
    return;
  }

  const router = createCharacterRouter(config);
  await router(interaction);
}

/**
 * Autocomplete handler
 */
export async function autocomplete(
  interaction: import('discord.js').AutocompleteInteraction
): Promise<void> {
  await handleAutocomplete(interaction);
}
