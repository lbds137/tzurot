/**
 * Memory Command - Interaction Handlers
 *
 * Handles button, modal, and select menu interactions for memory detail actions.
 * Extracted from index.ts to stay within max-lines limit.
 */

import { MessageFlags } from 'discord.js';
import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import {
  parseMemoryActionId,
  handleLockButton,
  handleDeleteButton,
  handleDeleteConfirm,
  handleViewFullButton,
} from './detail.js';
import {
  handleEditButton,
  handleEditTruncatedButton,
  handleCancelEditButton,
  handleEditModalSubmit,
} from './detailModals.js';
import { hasActiveCollector } from '../../utils/activeCollectorRegistry.js';

const logger = createLogger('memory-command');

/**
 * Handle button interactions for memory detail actions
 * Routes edit, lock, delete, and back actions to appropriate handlers
 *
 * Uses the active collector registry to avoid race conditions:
 * - If a collector is active for this message, ignore the interaction (collector handles it)
 * - If no collector active, this is an expired interaction - show message
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- pre-existing
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const messageId = interaction.message?.id;

  // Check if an active collector is handling this message
  // If so, ignore - the collector will handle this interaction
  if (messageId !== undefined && hasActiveCollector(messageId)) {
    logger.debug(
      { customId: interaction.customId, messageId },
      '[Memory] Ignoring button - active collector will handle'
    );
    return;
  }

  // No active collector - this interaction is from an expired/orphaned message
  const parsed = parseMemoryActionId(interaction.customId);

  // Pagination button without active collector = expired
  if (parsed === null) {
    logger.debug({ customId: interaction.customId }, '[Memory] Handling expired pagination button');
    await interaction.reply({
      content: '⏰ This interaction has expired. Please run the command again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { action, memoryId } = parsed;

  switch (action) {
    case 'edit':
      if (memoryId !== undefined) {
        await handleEditButton(interaction, memoryId);
      }
      break;
    case 'edit-truncated':
      if (memoryId !== undefined) {
        await handleEditTruncatedButton(interaction, memoryId);
      }
      break;
    case 'cancel-edit':
      await handleCancelEditButton(interaction);
      break;
    case 'lock':
      if (memoryId !== undefined) {
        await handleLockButton(interaction, memoryId);
      }
      break;
    case 'delete':
      if (memoryId !== undefined) {
        await handleDeleteButton(interaction, memoryId);
      }
      break;
    case 'confirm-delete':
      if (memoryId !== undefined) {
        const success = await handleDeleteConfirm(interaction, memoryId);
        if (success) {
          await interaction.editReply({
            embeds: [],
            components: [],
            content: '✅ Memory deleted successfully.',
          });
        }
      }
      break;
    case 'view-full':
      if (memoryId !== undefined) {
        await handleViewFullButton(interaction, memoryId);
      }
      break;
    case 'back':
      // Back button needs to return to list/search - but without collector context,
      // we can only show an expired message
      await interaction.reply({
        content:
          '⏰ This interaction has expired. Please run the command again to return to the list.',
        flags: MessageFlags.Ephemeral,
      });
      break;
    default:
      logger.warn({ action, customId: interaction.customId }, '[Memory] Unknown detail action');
      await interaction.reply({
        content: '❌ Unknown action.',
        flags: MessageFlags.Ephemeral,
      });
  }
}

/**
 * Handle modal submit interactions for memory editing
 *
 * NOTE: This is correctly named `handleModal`, NOT `handleModalSubmit`!
 * The typo `handleModalSubmit` was the original bug that prompted this refactoring.
 * With defineCommand, TypeScript would catch such a typo at compile time.
 */
export async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parsed = parseMemoryActionId(interaction.customId);

  if (parsed?.action !== 'edit') {
    logger.warn({ customId: interaction.customId }, '[Memory] Unknown modal');
    return;
  }

  if (parsed.memoryId !== undefined) {
    await handleEditModalSubmit(interaction, parsed.memoryId);
  }
}

/**
 * Handle select menu interactions for memory detail
 *
 * Select menus are primarily handled by collectors in list.ts and search.ts.
 * This handler catches orphaned interactions when:
 * - The collector has timed out
 * - The original message no longer has an active collector
 *
 * In those cases, we show an "expired" message since we don't have the
 * necessary context (page, personality filter, search query) to proceed.
 */
export async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const messageId = interaction.message?.id;

  // Check if an active collector is handling this message
  // If so, ignore - the collector will handle this interaction
  if (messageId !== undefined && hasActiveCollector(messageId)) {
    logger.debug(
      { customId: interaction.customId, messageId },
      '[Memory] Ignoring select menu - active collector will handle'
    );
    return;
  }

  // No active collector - this interaction is from an expired/orphaned message
  logger.debug({ customId: interaction.customId }, '[Memory] Handling expired select menu');
  await interaction.reply({
    content: '⏰ This interaction has expired. Please run the command again.',
    flags: MessageFlags.Ephemeral,
  });
}
