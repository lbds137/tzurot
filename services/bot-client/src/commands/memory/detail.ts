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
  MessageFlags,
  escapeMarkdown,
  AttachmentBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { type MemoryItem } from '@tzurot/common-types/schemas/api/memory';
import { formatDateTimeCompact } from '@tzurot/common-types/utils/dateFormatting';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { CUSTOM_ID_DELIMITER } from '../../utils/customIds.js';
import { buildEntityDetailCard } from '../../utils/detailCard.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { followUpSpec, replySpec } from '../../ux/render/reply.js';

import { fetchMemory, setMemoryLock, deleteMemory } from './detailApi.js';
import { EMBED_DESCRIPTION_SAFE_LIMIT } from './formatters.js';

const logger = createLogger('memory-detail');

/** Custom ID prefix for memory detail actions */
export const MEMORY_DETAIL_PREFIX = 'memory-detail';

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
 * Build the detail view embed for a single memory
 * Returns the embed and whether content was truncated
 */
export function buildDetailEmbed(memory: MemoryItem): {
  embed: EmbedBuilder;
  isTruncated: boolean;
} {
  const { embed, descriptionTruncated } = buildEntityDetailCard({
    title: `${memory.isLocked ? '🔒 ' : ''}Memory Details`,
    color: memory.isLocked ? DISCORD_COLORS.WARNING : DISCORD_COLORS.BLURPLE,
    description: escapeMarkdown(memory.content),
    descriptionCap: EMBED_DESCRIPTION_SAFE_LIMIT,
    truncationNotice: '\n\n*... Content truncated. Click "📄 View Full" to see complete memory.*',
    fields: [
      { name: 'Personality', value: escapeMarkdown(memory.personalityName), inline: true },
      { name: 'Status', value: memory.isLocked ? '🔒 Locked' : '🔓 Unlocked', inline: true },
      { name: 'Created', value: formatDateTimeCompact(memory.createdAt), inline: true },
      memory.updatedAt !== memory.createdAt && {
        name: 'Updated',
        value: formatDateTimeCompact(memory.updatedAt),
        inline: true,
      },
    ],
    footer: `Memory ID: ${memory.id.substring(0, 8)}...`,
  });

  return { embed, isTruncated: descriptionTruncated };
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
  // Use .setEmoji() separately for consistent button sizing
  const lockEmoji = memory.isLocked ? '🔓' : '🔒';
  const lockLabel = memory.isLocked ? 'Unlock' : 'Lock';
  const lockStyle = memory.isLocked ? ButtonStyle.Secondary : ButtonStyle.Primary;

  const buttons: ButtonBuilder[] = [
    new ButtonBuilder()
      .setCustomId(buildMemoryActionId('edit', memory.id))
      .setLabel('Edit')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      // Encode desired final state in customId — the API takes the target
      // state explicitly so retries can't accidentally flip the wrong way.
      .setCustomId(buildMemoryActionId('lock', memory.id, memory.isLocked ? '0' : '1'))
      .setLabel(lockLabel)
      .setEmoji(lockEmoji)
      .setStyle(lockStyle),
  ];

  // Add "View Full" button if content was truncated
  if (isTruncated) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(buildMemoryActionId('view-full', memory.id))
        .setLabel('View Full')
        .setEmoji('📄')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  // Back button comes before Delete (standard dashboard order)
  buttons.push(
    new ButtonBuilder()
      .setCustomId(buildMemoryActionId('back'))
      .setLabel('Back to List')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
  );

  // Delete button last (danger action should be visually last)
  buttons.push(
    new ButtonBuilder()
      .setCustomId(buildMemoryActionId('delete', memory.id))
      .setLabel('Delete')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger)
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
 * Handle memory select menu interaction — load the detail view for the
 * memory the user picked.
 *
 * Back navigation from detail view is handled post-migration by
 * detailActionRouter's `'back'` case, which calls refreshBrowseList /
 * refreshSearchList. Those look up the original list state via the
 * messageId-keyed dashboard session, so no context needs to be threaded
 * through this handler. (Pre-migration, the old collector closures kept
 * context in scope, which is why this function used to take a ListContext
 * parameter.)
 */
export async function handleMemorySelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const memoryId = interaction.values[0];

  await interaction.deferUpdate();

  const { userClient } = clientsFor(interaction);
  let memory: MemoryItem | null;
  try {
    memory = await fetchMemory(userClient, memoryId, interaction.user.id);
  } catch (error) {
    await followUpSpec(interaction, classifyGatewayFailure(error, 'memory', { operation: 'read' }));
    return;
  }
  if (memory === null) {
    // Genuine 404 — the memory really is gone (infra failures throw above).
    await followUpSpec(interaction, CATALOG.error.notFound('Memory'));
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
 * Handle lock/unlock button click.
 *
 * The desired target state is encoded in the customId by `buildDetailButtons`
 * — the button rendered while the memory is unlocked carries `'1'` (lock it),
 * while the button rendered for a locked memory carries `'0'` (unlock it).
 * The API takes the target state explicitly so a retried network request
 * can't accidentally flip the wrong way.
 */
export async function handleLockButton(
  interaction: ButtonInteraction,
  memoryId: string,
  desiredState: boolean
): Promise<void> {
  const userId = interaction.user.id;

  await interaction.deferUpdate();

  const { userClient } = clientsFor(interaction);
  let updatedMemory: MemoryItem | null;
  try {
    updatedMemory = await setMemoryLock(userClient, memoryId, desiredState, userId);
  } catch (error) {
    // A timeout here is outcome-UNCERTAIN (the lock may have applied) — the
    // classifier renders the honest shape instead of the old "try again" lie.
    await followUpSpec(interaction, classifyGatewayFailure(error, 'memory lock'));
    return;
  }
  if (updatedMemory === null) {
    await followUpSpec(interaction, CATALOG.error.notFound('Memory'));
    return;
  }

  const { embed, isTruncated } = buildDetailEmbed(updatedMemory);
  const buttons = buildDetailButtons(updatedMemory, isTruncated);

  await interaction.editReply({
    embeds: [embed],
    components: [buttons],
  });

  const action = updatedMemory.isLocked ? 'locked' : 'unlocked';
  logger.info({ userId, memoryId, action }, 'Memory lock set');
}

/**
 * Handle delete button click - show confirmation
 */
export async function handleDeleteButton(
  interaction: ButtonInteraction,
  memoryId: string
): Promise<void> {
  await interaction.deferUpdate();

  const { userClient } = clientsFor(interaction);
  let memory: MemoryItem | null;
  try {
    memory = await fetchMemory(userClient, memoryId, interaction.user.id);
  } catch (error) {
    await followUpSpec(interaction, classifyGatewayFailure(error, 'memory', { operation: 'read' }));
    return;
  }
  if (memory === null) {
    await followUpSpec(interaction, CATALOG.error.notFound('Memory'));
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
 *
 * Called from the session-dependent branch of interactionHandlers.handleButton,
 * which defers the interaction BEFORE this function runs so the upstream
 * session lookup stays inside the 3-second interaction window. Guard the
 * defer here so the function remains safe to call standalone (e.g., tests)
 * while not double-acking when the caller has already deferred.
 */
export async function handleDeleteConfirm(
  interaction: ButtonInteraction,
  memoryId: string
): Promise<boolean> {
  const userId = interaction.user.id;

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }

  const { userClient } = clientsFor(interaction);
  let success: boolean;
  try {
    success = await deleteMemory(userClient, memoryId, userId);
  } catch (error) {
    await followUpSpec(
      interaction,
      classifyGatewayFailure(error, 'memory', { failedAction: 'delete the memory' })
    );
    return false;
  }
  if (!success) {
    // Genuine 404 — already gone; surface as absence, not a retryable failure.
    await followUpSpec(interaction, CATALOG.error.notFound('Memory'));
    return false;
  }

  logger.info({ userId, memoryId }, 'Memory deleted');
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

  const { userClient } = clientsFor(interaction);
  let memory: MemoryItem | null;
  try {
    memory = await fetchMemory(userClient, memoryId, userId);
  } catch (error) {
    await replySpec(interaction, classifyGatewayFailure(error, 'memory', { operation: 'read' }));
    return;
  }
  if (memory === null) {
    await replySpec(interaction, CATALOG.error.notFound('Memory'));
    return;
  }

  // Create a text file attachment with the full content
  const buffer = Buffer.from(memory.content, 'utf-8');
  const attachment = new AttachmentBuilder(buffer, {
    name: `memory-${memoryId.substring(0, 8)}.txt`,
    description: `Full memory content for ${memory.personalityName}`,
  });

  await interaction.editReply({
    content: `📄 **Full Memory Content** (${memory.personalityName})\nCreated: ${formatDateTimeCompact(memory.createdAt)}`,
    files: [attachment],
  });

  logger.info({ userId, memoryId, contentLength: memory.content.length }, 'Full content sent');
}
