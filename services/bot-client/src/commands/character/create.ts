/**
 * Character Command - Create Handlers
 *
 * Handles character creation flow:
 * 1. /character create → Shows seed modal
 * 2. Modal submit → Creates character via API
 * 3. Shows dashboard for further editing
 */

import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type ModalActionRowComponentBuilder,
  MessageFlags,
} from 'discord.js';
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { createLogger, type EnvConfig, DISCORD_LIMITS } from '@tzurot/common-types';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  buildDashboardCustomId,
  extractModalValues,
  getSessionManager,
} from '../../utils/dashboard/index.js';
import { normalizeSlugForUser } from '../../utils/slugUtils.js';
import { characterDashboardConfig, characterSeedFields } from './config.js';
import { createCharacter } from './api.js';

const logger = createLogger('character-create');

/**
 * Show the seed modal for character creation
 */
export async function handleCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId(buildDashboardCustomId('character', 'seed'))
    .setTitle('Create New Character');

  for (const field of characterSeedFields) {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(field.label)
      .setPlaceholder(field.placeholder ?? '')
      .setStyle(field.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(field.required ?? false)
      .setMaxLength(field.maxLength ?? DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH);

    const row = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
    modal.addComponents(row);
  }

  await interaction.showModal(modal);
}

/**
 * Handle seed modal submission - create new character
 */
export async function handleSeedModalSubmit(
  interaction: ModalSubmitInteraction,
  config: EnvConfig
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const values = extractModalValues(
    interaction,
    characterSeedFields.map(f => f.id)
  );

  // Validate slug format (before normalization)
  if (!/^[a-z0-9-]+$/.test(values.slug)) {
    await interaction.editReply(
      '❌ Invalid slug format. Use only lowercase letters, numbers, and hyphens.\n' +
        `Example: \`${values.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}\``
    );
    return;
  }

  // Normalize slug: append username for non-bot-owners
  const normalizedSlug = normalizeSlugForUser(
    values.slug,
    interaction.user.id,
    interaction.user.username
  );

  try {
    // Create character via API
    const character = await createCharacter(
      {
        name: values.name,
        slug: normalizedSlug,
        characterInfo: values.characterInfo,
        personalityTraits: values.personalityTraits,
        isPublic: false, // Default to private
      },
      interaction.user.id,
      config
    );

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

    // Create session (keyed by slug)
    const sessionManager = getSessionManager();
    await sessionManager.set({
      userId: interaction.user.id,
      entityType: 'character',
      entityId: character.slug,
      data: character,
      messageId: reply.id,
      channelId: interaction.channelId ?? '',
    });

    logger.info(
      { userId: interaction.user.id, slug: character.slug },
      'Character created via seed modal'
    );
  } catch (error) {
    logger.error({ err: error }, 'Failed to create character');

    // Check for duplicate slug error
    if (error instanceof Error && error.message.includes('409')) {
      await interaction.editReply(
        `❌ A character with slug \`${normalizedSlug}\` already exists.\n` +
          'Please choose a different slug.'
      );
      return;
    }

    await interaction.editReply('❌ Failed to create character. Please try again.');
  }
}
