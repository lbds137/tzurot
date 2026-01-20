/**
 * Memory Detail Modal Handlers
 * Modal builders and handlers for memory editing
 */

import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { buildMemoryActionId } from './detail.js';
import { fetchMemory, updateMemory } from './detailApi.js';
import { buildDetailEmbed, buildDetailButtons } from './detail.js';
import type { MemoryItem } from './detail.js';

const logger = createLogger('memory-detail-modals');

/**
 * Maximum content length for memory editing.
 * This must match the max_length we set on the TextInput component.
 * Discord requires that pre-filled value ≤ max_length.
 *
 * We use 2000 for consistency with API validation (memorySingle.ts MAX_CONTENT_LENGTH).
 */
export const MAX_MODAL_CONTENT_LENGTH = 2000;

/**
 * Build the edit modal for memory content
 * @param memory The memory to edit
 * @param contentOverride Optional content to use instead of memory.content (for truncated content)
 */
export function buildEditModal(memory: MemoryItem, contentOverride?: string): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildMemoryActionId('edit', memory.id, 'modal'))
    .setTitle('Edit Memory');

  const content = contentOverride ?? memory.content;

  const contentInput = new TextInputBuilder()
    .setCustomId('content')
    .setLabel('Memory Content')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(content)
    .setMaxLength(MAX_MODAL_CONTENT_LENGTH)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(contentInput));

  return modal;
}

/**
 * Build confirmation embed for truncation warning
 */
function buildTruncationWarningEmbed(memory: MemoryItem): EmbedBuilder {
  const charCount = memory.content.length;
  const truncatedPreview = memory.content.substring(0, 200) + '...';

  return new EmbedBuilder()
    .setTitle('⚠️ Memory Too Long to Edit')
    .setColor(DISCORD_COLORS.WARNING)
    .setDescription(
      `This memory contains **${charCount.toLocaleString()} characters**, which exceeds the edit limit of ${MAX_MODAL_CONTENT_LENGTH.toLocaleString()} characters.\n\n` +
        `**To edit this memory, it must be truncated to ${MAX_MODAL_CONTENT_LENGTH.toLocaleString()} characters.**\n\n` +
        `⚠️ **This is a destructive action** - the truncated content will be lost permanently when you save.\n\n` +
        `**Preview of content:**\n\`\`\`\n${truncatedPreview}\n\`\`\``
    )
    .setFooter({ text: `${charCount - MAX_MODAL_CONTENT_LENGTH} characters will be removed` });
}

/**
 * Build confirmation buttons for truncation
 */
function buildTruncationButtons(memoryId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildMemoryActionId('edit-truncated', memoryId))
      .setLabel('Edit with Truncation')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('✂️'),
    new ButtonBuilder()
      .setCustomId(buildMemoryActionId('cancel-edit', memoryId))
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );
}

/**
 * Handle edit button click - show modal or truncation warning
 */
export async function handleEditButton(
  interaction: ButtonInteraction,
  memoryId: string
): Promise<void> {
  const userId = interaction.user.id;

  const memory = await fetchMemory(userId, memoryId);
  if (memory === null) {
    await interaction.reply({
      content: '❌ Failed to load memory. It may have been deleted.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if content exceeds our modal's max_length setting
  // Must use MAX_MODAL_CONTENT_LENGTH (2000) because Discord requires value ≤ max_length
  if (memory.content.length > MAX_MODAL_CONTENT_LENGTH) {
    // Show truncation warning with confirmation buttons
    const embed = buildTruncationWarningEmbed(memory);
    const buttons = buildTruncationButtons(memoryId);

    await interaction.reply({
      embeds: [embed],
      components: [buttons],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modal = buildEditModal(memory);
  await interaction.showModal(modal);
}

/**
 * Handle edit-truncated button - show modal with truncated content
 */
export async function handleEditTruncatedButton(
  interaction: ButtonInteraction,
  memoryId: string
): Promise<void> {
  const userId = interaction.user.id;

  const memory = await fetchMemory(userId, memoryId);
  if (memory === null) {
    await interaction.update({
      content: '❌ Failed to load memory. It may have been deleted.',
      embeds: [],
      components: [],
    });
    return;
  }

  // Truncate content to our max_length setting
  const truncatedContent = memory.content.substring(0, MAX_MODAL_CONTENT_LENGTH);

  const modal = buildEditModal(memory, truncatedContent);
  await interaction.showModal(modal);
}

/**
 * Handle cancel-edit button - dismiss the truncation warning
 */
export async function handleCancelEditButton(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    content: '✅ Edit cancelled.',
    embeds: [],
    components: [],
  });
}

/**
 * Handle edit modal submission
 */
export async function handleEditModalSubmit(
  interaction: ModalSubmitInteraction,
  memoryId: string
): Promise<void> {
  const userId = interaction.user.id;
  const newContent = interaction.fields.getTextInputValue('content');

  try {
    await interaction.deferUpdate();
  } catch (deferError) {
    // Interaction may have expired or already been responded to
    logger.warn(
      { err: deferError, userId, memoryId },
      '[Memory] Failed to defer modal update - interaction may have expired'
    );
    // Try to reply instead
    try {
      await interaction.reply({
        content: '⏰ This interaction has expired. Your changes were not saved.',
        flags: MessageFlags.Ephemeral,
      });
    } catch {
      // Ignore - interaction is completely dead
    }
    return;
  }

  const updatedMemory = await updateMemory(userId, memoryId, newContent);
  if (updatedMemory === null) {
    await interaction.followUp({
      content: '❌ Failed to update memory. Please try again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { embed, isTruncated } = buildDetailEmbed(updatedMemory);
  const buttons = buildDetailButtons(updatedMemory, isTruncated);

  try {
    await interaction.editReply({
      embeds: [embed],
      components: [buttons],
    });
  } catch (editError) {
    logger.warn(
      { err: editError, userId, memoryId },
      '[Memory] Failed to edit reply after modal submit'
    );
    // Try followUp as fallback
    try {
      await interaction.followUp({
        content: '✅ Memory updated successfully, but the display could not be refreshed.',
        flags: MessageFlags.Ephemeral,
      });
    } catch {
      // Ignore - best effort
    }
    return;
  }

  logger.info({ userId, memoryId }, '[Memory] Memory updated');
}
