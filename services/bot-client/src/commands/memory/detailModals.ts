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
} from 'discord.js';
import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { buildMemoryActionId } from './detail.js';
import { fetchMemory, updateMemory } from './detailApi.js';
import { buildDetailEmbed, buildDetailButtons } from './detail.js';
import type { MemoryItem } from './detail.js';

const logger = createLogger('memory-detail-modals');

/**
 * Maximum content length for modal text input.
 * Discord modals support 4000 chars, but we limit to 2000 for consistency
 * with API validation (memorySingle.ts MAX_CONTENT_LENGTH).
 */
export const MAX_MODAL_CONTENT_LENGTH = 2000;

/**
 * Build the edit modal for memory content
 */
export function buildEditModal(memory: MemoryItem): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildMemoryActionId('edit', memory.id, 'modal'))
    .setTitle('Edit Memory');

  const contentInput = new TextInputBuilder()
    .setCustomId('content')
    .setLabel('Memory Content')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(memory.content)
    .setMaxLength(MAX_MODAL_CONTENT_LENGTH)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(contentInput));

  return modal;
}

/**
 * Handle edit button click - show modal
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

  const modal = buildEditModal(memory);
  await interaction.showModal(modal);
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

  await interaction.deferUpdate();

  const updatedMemory = await updateMemory(userId, memoryId, newContent);
  if (updatedMemory === null) {
    await interaction.followUp({
      content: '❌ Failed to update memory. Please try again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = buildDetailEmbed(updatedMemory);
  const buttons = buildDetailButtons(updatedMemory);

  await interaction.editReply({
    embeds: [embed],
    components: [buttons],
  });

  logger.info({ userId, memoryId }, '[Memory] Memory updated');
}
