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

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { createLogger, getConfig, type EnvConfig } from '@tzurot/common-types';
import { createSubcommandRouter } from '../../utils/subcommandRouter.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
} from '../../utils/dashboard/index.js';
import { characterDashboardConfig } from './config.js';

// Import handlers from split modules
import { handleAutocomplete } from './autocomplete.js';
import { handleImport } from './import.js';
import { handleExport } from './export.js';
import { handleTemplate } from './template.js';
import { handleView } from './view.js';
import { handleCreate } from './create.js';
import { handleList, escapeMarkdown } from './list.js';
import {
  handleModalSubmit,
  handleSelectMenu,
  handleButton,
  isCharacterDashboardInteraction,
} from './dashboard.js';
import { fetchCharacter, updateCharacter } from './api.js';

const logger = createLogger('character-command');

// Re-export for external use
export { escapeMarkdown };
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
  );

/**
 * Handle the edit subcommand - show dashboard for selected character
 */
async function handleEdit(
  interaction: ChatInputCommandInteraction,
  config: EnvConfig
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const slug = interaction.options.getString('character', true);

  try {
    // Fetch character data from API
    const character = await fetchCharacter(slug, config, interaction.user.id);
    if (!character) {
      await interaction.editReply(`❌ Character \`${slug}\` not found or not accessible.`);
      return;
    }

    // Use server-side permission check (compares internal User UUIDs, not Discord IDs)
    if (!character.canEdit) {
      await interaction.editReply(
        `❌ You don't have permission to edit \`${slug}\`.\n` +
          'You can only edit characters you own.'
      );
      return;
    }

    // Build and send dashboard
    // Use slug as entityId (not UUID) because fetchCharacter expects slug
    const embed = buildDashboardEmbed(characterDashboardConfig, character);
    const components = buildDashboardComponents(
      characterDashboardConfig,
      character.slug,
      character,
      {
        showClose: true,
        showRefresh: true,
      }
    );

    const reply = await interaction.editReply({ embeds: [embed], components });

    // Create session for tracking (keyed by slug)
    const sessionManager = getSessionManager();
    sessionManager.set(
      interaction.user.id,
      'character',
      character.slug,
      character,
      reply.id,
      interaction.channelId
    );

    logger.info(
      { userId: interaction.user.id, slug: character.slug },
      'Character dashboard opened'
    );
  } catch (error) {
    logger.error({ err: error, slug }, 'Failed to open character dashboard');
    await interaction.editReply('❌ Failed to load character. Please try again.');
  }
}

/**
 * Handle avatar upload subcommand
 */
async function handleAvatar(
  interaction: ChatInputCommandInteraction,
  config: EnvConfig
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const slug = interaction.options.getString('character', true);
  const attachment = interaction.options.getAttachment('image', true);

  // Validate attachment is an image
  const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  if (attachment.contentType === null || !validTypes.includes(attachment.contentType)) {
    await interaction.editReply(
      '❌ Invalid image format. Please upload a PNG, JPG, GIF, or WebP image.'
    );
    return;
  }

  // Check file size (max 8MB before processing)
  const MAX_SIZE_MB = 8;
  if (attachment.size > MAX_SIZE_MB * 1024 * 1024) {
    await interaction.editReply(
      `❌ Image too large. Please upload an image under ${MAX_SIZE_MB}MB.`
    );
    return;
  }

  try {
    // Check if user can edit this character
    const character = await fetchCharacter(slug, config, interaction.user.id);
    if (!character) {
      await interaction.editReply(`❌ Character \`${slug}\` not found or not accessible.`);
      return;
    }

    // Use server-side permission check (compares internal User UUIDs, not Discord IDs)
    if (!character.canEdit) {
      await interaction.editReply(
        `❌ You don't have permission to edit \`${slug}\`.\n` +
          'You can only edit characters you own.'
      );
      return;
    }

    // Download the image
    const imageResponse = await fetch(attachment.url);
    if (!imageResponse.ok) {
      await interaction.editReply('❌ Failed to download the image. Please try again.');
      return;
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    const base64Image = imageBuffer.toString('base64');

    // Update character with new avatar
    await updateCharacter(slug, { avatarData: base64Image }, interaction.user.id, config);

    await interaction.editReply(
      `✅ Avatar updated for **${character.displayName ?? character.name}**!`
    );

    logger.info({ slug, userId: interaction.user.id }, 'Character avatar updated');
  } catch (error) {
    logger.error({ err: error, slug }, 'Failed to update avatar');
    await interaction.editReply('❌ Failed to update avatar. Please try again.');
  }
}

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
      view: interaction => handleView(interaction, config),
      list: interaction => handleList(interaction, config),
      avatar: interaction => handleAvatar(interaction, config),
      import: interaction => handleImport(interaction, config),
      export: interaction => handleExport(interaction, config),
      template: interaction => handleTemplate(interaction, config),
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
