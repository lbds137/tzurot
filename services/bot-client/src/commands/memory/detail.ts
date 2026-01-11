/**
 * Memory Detail View
 * Shared component for viewing and managing individual memories
 * Used by both /memory list and /memory search
 */

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  escapeMarkdown,
} from 'discord.js';
import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { CUSTOM_ID_DELIMITER } from '../../utils/customIds.js';

const logger = createLogger('memory-detail');

/** Custom ID prefix for memory detail actions */
export const MEMORY_DETAIL_PREFIX = 'memory-detail';

/** Maximum label length for select menu options */
const MAX_SELECT_LABEL_LENGTH = 100;

/** Overhead for select label (number prefix "1. " to "99. " + optional lock icon "🔒 ") */
const SELECT_LABEL_OVERHEAD = 10;

/** Maximum content length for modal text input */
const MAX_MODAL_CONTENT_LENGTH = 2000;

/**
 * Memory item structure from API
 */
export interface MemoryItem {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  personalityId: string;
  personalityName: string;
  isLocked: boolean;
}

/**
 * Context needed to return to list view
 */
export interface ListContext {
  /** 'list' or 'search' */
  source: 'list' | 'search';
  /** Current page (0-indexed) */
  page: number;
  /** Personality filter if any */
  personalityId?: string;
  /** Search query (for search source) */
  query?: string;
  /** Search type hint (for search source) */
  preferTextSearch?: boolean;
}

/**
 * Build custom ID for memory actions
 */
export function buildMemoryActionId(
  action: 'select' | 'view' | 'edit' | 'lock' | 'delete' | 'back' | 'confirm-delete',
  memoryId?: string,
  extra?: string
): string {
  const parts = [MEMORY_DETAIL_PREFIX, action];
  if (memoryId !== undefined) {
    parts.push(memoryId);
  }
  if (extra !== undefined) {
    parts.push(extra);
  }
  return parts.join(CUSTOM_ID_DELIMITER);
}

/**
 * Parse a memory action custom ID
 */
export function parseMemoryActionId(customId: string): {
  action: string;
  memoryId?: string;
  extra?: string;
} | null {
  if (!customId.startsWith(MEMORY_DETAIL_PREFIX)) {
    return null;
  }

  const parts = customId.split(CUSTOM_ID_DELIMITER);
  if (parts.length < 2) {
    return null;
  }

  return {
    action: parts[1],
    memoryId: parts[2],
    extra: parts[3],
  };
}

/**
 * Truncate text for select menu label
 */
function truncateForSelect(text: string, maxLength: number = MAX_SELECT_LABEL_LENGTH): string {
  const singleLine = text.replace(/\n+/g, ' ').trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return singleLine.substring(0, maxLength - 3) + '...';
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Build select menu for choosing a memory from the list
 */
export function buildMemorySelectMenu(
  memories: MemoryItem[],
  page: number,
  itemsPerPage: number
): ActionRowBuilder<StringSelectMenuBuilder> {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(buildMemoryActionId('select'))
    .setPlaceholder('Select a memory to manage...')
    .setMinValues(1)
    .setMaxValues(1);

  memories.forEach((memory, index) => {
    const num = page * itemsPerPage + index + 1;
    const lockIcon = memory.isLocked ? '🔒 ' : '';
    const label = `${num}. ${lockIcon}${truncateForSelect(memory.content, MAX_SELECT_LABEL_LENGTH - SELECT_LABEL_OVERHEAD)}`;

    selectMenu.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(label)
        .setValue(memory.id)
        .setDescription(`${memory.personalityName} • ${formatDate(memory.createdAt).split(',')[0]}`)
    );
  });

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
}

/**
 * Build the detail view embed for a single memory
 */
export function buildDetailEmbed(memory: MemoryItem): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${memory.isLocked ? '🔒 ' : ''}Memory Details`)
    .setColor(memory.isLocked ? DISCORD_COLORS.WARNING : DISCORD_COLORS.BLURPLE)
    .setDescription(escapeMarkdown(memory.content));

  embed.addFields(
    { name: 'Personality', value: escapeMarkdown(memory.personalityName), inline: true },
    { name: 'Status', value: memory.isLocked ? '🔒 Locked' : '🔓 Unlocked', inline: true },
    { name: 'Created', value: formatDate(memory.createdAt), inline: true }
  );

  if (memory.updatedAt !== memory.createdAt) {
    embed.addFields({ name: 'Updated', value: formatDate(memory.updatedAt), inline: true });
  }

  embed.setFooter({ text: `Memory ID: ${memory.id.substring(0, 8)}...` });

  return embed;
}

/**
 * Build action buttons for the detail view
 */
export function buildDetailButtons(memory: MemoryItem): ActionRowBuilder<ButtonBuilder> {
  const lockLabel = memory.isLocked ? '🔓 Unlock' : '🔒 Lock';
  const lockStyle = memory.isLocked ? ButtonStyle.Secondary : ButtonStyle.Primary;

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildMemoryActionId('edit', memory.id))
      .setLabel('✏️ Edit')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildMemoryActionId('lock', memory.id))
      .setLabel(lockLabel)
      .setStyle(lockStyle),
    new ButtonBuilder()
      .setCustomId(buildMemoryActionId('delete', memory.id))
      .setLabel('🗑️ Delete')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(buildMemoryActionId('back'))
      .setLabel('↩️ Back to List')
      .setStyle(ButtonStyle.Secondary)
  );
}

/**
 * Build delete confirmation buttons
 */
export function buildDeleteConfirmButtons(memoryId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildMemoryActionId('back'))
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildMemoryActionId('confirm-delete', memoryId))
      .setLabel('Yes, Delete')
      .setStyle(ButtonStyle.Danger)
  );
}

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
 * API response for single memory
 */
interface SingleMemoryResponse {
  memory: MemoryItem;
}

/**
 * Fetch a single memory by ID
 */
export async function fetchMemory(userId: string, memoryId: string): Promise<MemoryItem | null> {
  const result = await callGatewayApi<SingleMemoryResponse>(`/user/memory/${memoryId}`, {
    userId,
    method: 'GET',
  });

  if (!result.ok) {
    logger.warn({ userId, memoryId, error: result.error }, '[Memory] Failed to fetch memory');
    return null;
  }

  return result.data.memory;
}

/**
 * Update memory content
 */
export async function updateMemory(
  userId: string,
  memoryId: string,
  content: string
): Promise<MemoryItem | null> {
  const result = await callGatewayApi<SingleMemoryResponse>(`/user/memory/${memoryId}`, {
    userId,
    method: 'PATCH',
    body: { content },
  });

  if (!result.ok) {
    logger.warn({ userId, memoryId, error: result.error }, '[Memory] Failed to update memory');
    return null;
  }

  return result.data.memory;
}

/**
 * Toggle memory lock status
 */
export async function toggleMemoryLock(
  userId: string,
  memoryId: string
): Promise<MemoryItem | null> {
  const result = await callGatewayApi<SingleMemoryResponse>(`/user/memory/${memoryId}/lock`, {
    userId,
    method: 'POST',
  });

  if (!result.ok) {
    logger.warn({ userId, memoryId, error: result.error }, '[Memory] Failed to toggle lock');
    return null;
  }

  return result.data.memory;
}

/**
 * Delete a memory
 */
export async function deleteMemory(userId: string, memoryId: string): Promise<boolean> {
  const result = await callGatewayApi<{ success: boolean }>(`/user/memory/${memoryId}`, {
    userId,
    method: 'DELETE',
  });

  if (!result.ok) {
    logger.warn({ userId, memoryId, error: result.error }, '[Memory] Failed to delete memory');
    return false;
  }

  return result.data.success;
}

/**
 * Handle memory select menu interaction
 */
export async function handleMemorySelect(
  interaction: StringSelectMenuInteraction,
  _context: ListContext
): Promise<void> {
  const userId = interaction.user.id;
  const memoryId = interaction.values[0];

  await interaction.deferUpdate();

  const memory = await fetchMemory(userId, memoryId);
  if (memory === null) {
    await interaction.followUp({
      content: '❌ Failed to load memory details. It may have been deleted.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = buildDetailEmbed(memory);
  const buttons = buildDetailButtons(memory);

  await interaction.editReply({
    embeds: [embed],
    components: [buttons],
  });
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

/**
 * Handle lock/unlock button click
 */
export async function handleLockButton(
  interaction: ButtonInteraction,
  memoryId: string
): Promise<void> {
  const userId = interaction.user.id;

  await interaction.deferUpdate();

  const updatedMemory = await toggleMemoryLock(userId, memoryId);
  if (updatedMemory === null) {
    await interaction.followUp({
      content: '❌ Failed to update lock status. Please try again.',
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

  const action = updatedMemory.isLocked ? 'locked' : 'unlocked';
  logger.info({ userId, memoryId, action }, '[Memory] Memory lock toggled');
}

/**
 * Handle delete button click - show confirmation
 */
export async function handleDeleteButton(
  interaction: ButtonInteraction,
  memoryId: string
): Promise<void> {
  const userId = interaction.user.id;

  await interaction.deferUpdate();

  const memory = await fetchMemory(userId, memoryId);
  if (memory === null) {
    await interaction.followUp({
      content: '❌ Failed to load memory. It may have already been deleted.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('⚠️ Delete Memory?')
    .setColor(DISCORD_COLORS.ERROR)
    .setDescription(
      `Are you sure you want to delete this memory?\n\n` +
        `> ${escapeMarkdown(memory.content.substring(0, 200))}${memory.content.length > 200 ? '...' : ''}\n\n` +
        `**This action cannot be undone.**`
    );

  const buttons = buildDeleteConfirmButtons(memoryId);

  await interaction.editReply({
    embeds: [embed],
    components: [buttons],
  });
}

/**
 * Handle delete confirmation
 */
export async function handleDeleteConfirm(
  interaction: ButtonInteraction,
  memoryId: string
): Promise<boolean> {
  const userId = interaction.user.id;

  await interaction.deferUpdate();

  const success = await deleteMemory(userId, memoryId);
  if (!success) {
    await interaction.followUp({
      content: '❌ Failed to delete memory. Please try again.',
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  logger.info({ userId, memoryId }, '[Memory] Memory deleted');
  return true;
}
