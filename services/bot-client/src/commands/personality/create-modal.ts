/**
 * Personality Create Modal Subcommand
 * Handles /personality create-modal
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { DISCORD_LIMITS, createLogger } from '@tzurot/common-types';

const logger = createLogger('personality-create-modal');

/**
 * Handle /personality create-modal subcommand
 * Shows a modal with text inputs for personality creation
 */
export async function handleCreateModal(interaction: ChatInputCommandInteraction): Promise<void> {
  // Create modal with text inputs
  const modal = new ModalBuilder()
    .setCustomId('personality-create')
    .setTitle('Create New Personality');

  // Name input (required)
  const nameInput = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Name')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Lilith')
    .setRequired(true)
    .setMaxLength(255);

  // Slug input (required)
  const slugInput = new TextInputBuilder()
    .setCustomId('slug')
    .setLabel('Slug (lowercase, hyphens only)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('lilith')
    .setRequired(true)
    .setMaxLength(255);

  // Character Info input (required, paragraph style for long text)
  const characterInfoInput = new TextInputBuilder()
    .setCustomId('characterInfo')
    .setLabel('Character Info')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Background, description, and context for this personality...')
    .setRequired(true)
    .setMaxLength(DISCORD_LIMITS.EMBED_DESCRIPTION);

  // Personality Traits input (required, paragraph style for long text)
  const personalityTraitsInput = new TextInputBuilder()
    .setCustomId('personalityTraits')
    .setLabel('Personality Traits')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Key traits, behaviors, and characteristics...')
    .setRequired(true)
    .setMaxLength(DISCORD_LIMITS.EMBED_DESCRIPTION);

  // Display Name input (optional)
  const displayNameInput = new TextInputBuilder()
    .setCustomId('displayName')
    .setLabel('Display Name (optional)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Leave empty to use Name')
    .setRequired(false)
    .setMaxLength(255);

  // Add inputs to action rows (max 1 input per row)
  const rows = [
    new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(slugInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(characterInfoInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(personalityTraitsInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(displayNameInput),
  ];

  modal.addComponents(...rows);

  // Show modal to user
  await interaction.showModal(modal);
  logger.info(`[Personality Create Modal] Modal shown to ${interaction.user.tag}`);
}
