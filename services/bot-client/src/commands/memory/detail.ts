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
  MessageFlags,
  escapeMarkdown,
  AttachmentBuilder,
} from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { CUSTOM_ID_DELIMITER } from '../../utils/customIds.js';

// Re-export API functions for backward compatibility
export { fetchMemory, updateMemory, toggleMemoryLock, deleteMemory } from './detailApi.js';
import { fetchMemory, toggleMemoryLock, deleteMemory } from './detailApi.js';

// Re-export modal functions for backward compatibility
export {
  buildEditModal,
  handleEditButton,
  handleEditTruncatedButton,
  handleCancelEditButton,
  handleEditModalSubmit,
  MAX_MODAL_CONTENT_LENGTH,
} from './detailModals.js';
import { formatDateShort, formatDateTime, EMBED_DESCRIPTION_SAFE_LIMIT } from './formatters.js';

const logger = createLogger('memory-detail');

/** Custom ID prefix for memory detail actions */
export const MEMORY_DETAIL_PREFIX = 'memory-detail';

/** Maximum label length for select menu options */
const MAX_SELECT_LABEL_LENGTH = 100;

/** Overhead for select label (number prefix "1. " to "99. " + optional lock icon "🔒 ") */
const SELECT_LABEL_OVERHEAD = 10;

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
  action:
    | 'select'
    | 'view'
    | 'edit'
    | 'edit-truncated'
    | 'cancel-edit'
    | 'lock'
    | 'delete'
    | 'back'
    | 'confirm-delete'
    | 'view-full',
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
        .setDescription(`${memory.personalityName} • ${formatDateShort(memory.createdAt)}`)
    );
  });

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
}

/**
 * Build the detail view embed for a single memory
 * Returns the embed and whether content was truncated
 */
export function buildDetailEmbed(memory: MemoryItem): {
  embed: EmbedBuilder;
  isTruncated: boolean;
} {
  const escapedContent = escapeMarkdown(memory.content);
  const isTruncated = escapedContent.length > EMBED_DESCRIPTION_SAFE_LIMIT;

  // Truncate if needed, indicating there's more content
  const displayContent = isTruncated
    ? escapedContent.substring(0, EMBED_DESCRIPTION_SAFE_LIMIT - 50) +
      '\n\n*... Content truncated. Click "📄 View Full" to see complete memory.*'
    : escapedContent;

  const embed = new EmbedBuilder()
    .setTitle(`${memory.isLocked ? '🔒 ' : ''}Memory Details`)
    .setColor(memory.isLocked ? DISCORD_COLORS.WARNING : DISCORD_COLORS.BLURPLE)
    .setDescription(displayContent);

  embed.addFields(
    { name: 'Personality', value: escapeMarkdown(memory.personalityName), inline: true },
    { name: 'Status', value: memory.isLocked ? '🔒 Locked' : '🔓 Unlocked', inline: true },
    { name: 'Created', value: formatDateTime(memory.createdAt), inline: true }
  );

  if (memory.updatedAt !== memory.createdAt) {
    embed.addFields({ name: 'Updated', value: formatDateTime(memory.updatedAt), inline: true });
  }

  embed.setFooter({ text: `Memory ID: ${memory.id.substring(0, 8)}...` });

  return { embed, isTruncated };
}

/**
 * Build action buttons for the detail view
 * @param memory - The memory item to build buttons for
 * @param isTruncated - Whether the content was truncated (shows "View Full" button)
 */
export function buildDetailButtons(
  memory: MemoryItem,
  isTruncated = false
): ActionRowBuilder<ButtonBuilder> {
  const lockLabel = memory.isLocked ? '🔓 Unlock' : '🔒 Lock';
  const lockStyle = memory.isLocked ? ButtonStyle.Secondary : ButtonStyle.Primary;

  const buttons: ButtonBuilder[] = [
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
  ];

  // Add "View Full" button if content was truncated
  if (isTruncated) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(buildMemoryActionId('view-full', memory.id))
        .setLabel('📄 View Full')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(buildMemoryActionId('back'))
      .setLabel('↩️ Back to List')
      .setStyle(ButtonStyle.Secondary)
  );

  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
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
 * Handle memory select menu interaction
 *
 * Note: _context is passed by the collector but not used here because the "back" navigation
 * is handled by the collector's closure which maintains its own context state. This parameter
 * is kept for API consistency and potential future use (e.g., embedding context in button IDs).
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

  const { embed, isTruncated } = buildDetailEmbed(memory);
  const buttons = buildDetailButtons(memory, isTruncated);

  await interaction.editReply({
    embeds: [embed],
    components: [buttons],
  });
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

  const { embed, isTruncated } = buildDetailEmbed(updatedMemory);
  const buttons = buildDetailButtons(updatedMemory, isTruncated);

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

/**
 * Handle "View Full" button click - sends full memory content as a text file
 */
export async function handleViewFullButton(
  interaction: ButtonInteraction,
  memoryId: string
): Promise<void> {
  const userId = interaction.user.id;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const memory = await fetchMemory(userId, memoryId);
  if (memory === null) {
    await interaction.editReply({
      content: '❌ Failed to load memory. It may have been deleted.',
    });
    return;
  }

  // Create a text file attachment with the full content
  const buffer = Buffer.from(memory.content, 'utf-8');
  const attachment = new AttachmentBuilder(buffer, {
    name: `memory-${memoryId.substring(0, 8)}.txt`,
    description: `Full memory content for ${memory.personalityName}`,
  });

  await interaction.editReply({
    content: `📄 **Full Memory Content** (${memory.personalityName})\nCreated: ${formatDateTime(memory.createdAt)}`,
    files: [attachment],
  });

  logger.info(
    { userId, memoryId, contentLength: memory.content.length },
    '[Memory] Full content sent'
  );
}
