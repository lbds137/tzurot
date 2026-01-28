/**
 * Batch Delete Handler
 * Handles /memory delete command - batch delete memories with filters
 * Uses a confirmation flow with danger button
 */

import {
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType,
  escapeMarkdown,
  type ButtonInteraction,
} from 'discord.js';
import {
  createLogger,
  Duration,
  DurationParseError,
  memoryDeleteOptions,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { createWarningEmbed, createSuccessEmbed } from '../../utils/commandHelpers.js';
import { resolvePersonalityId } from './autocomplete.js';

const logger = createLogger('memory-batch-delete');

/** Timeout for confirmation buttons (60 seconds) */
const CONFIRMATION_TIMEOUT = 60_000;

interface PreviewResponse {
  wouldDelete: number;
  lockedWouldSkip: number;
  personalityId: string;
  personalityName: string;
  timeframe: string;
}

interface DeleteResponse {
  deletedCount: number;
  skippedLocked: number;
  personalityId: string;
  personalityName: string;
  message: string;
}

/** Format timeframe for display using shared Duration class */
function formatTimeframe(timeframe: string | null): string {
  if (timeframe === null) {
    return 'all time';
  }

  try {
    const duration = Duration.parse(timeframe);
    return duration.toHuman();
  } catch (error) {
    if (error instanceof DurationParseError) {
      // Fallback to raw string if parsing fails
      return timeframe;
    }
    throw error;
  }
}

/**
 * Handle /memory delete
 * Shows preview and confirmation before batch deleting
 */
// eslint-disable-next-line max-lines-per-function, max-statements -- Discord command handler with sequential UI flow
export async function handleBatchDelete(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = memoryDeleteOptions(context.interaction);
  const personalityInput = options.personality();
  const timeframe = options.timeframe();

  try {
    // Resolve personality slug to ID
    const personalityId = await resolvePersonalityId(userId, personalityInput);

    if (personalityId === null) {
      await context.editReply({
        content: `❌ Personality "${personalityInput}" not found. Use autocomplete to select a valid personality.`,
      });
      return;
    }

    // Get preview of what would be deleted
    const queryParams = new URLSearchParams({ personalityId });
    if (timeframe !== null) {
      queryParams.set('timeframe', timeframe);
    }

    const previewResult = await callGatewayApi<PreviewResponse>(
      `/user/memory/delete/preview?${queryParams.toString()}`,
      {
        userId,
        method: 'GET',
      }
    );

    if (!previewResult.ok) {
      const errorMessage =
        previewResult.status === 404
          ? `Personality "${personalityInput}" not found.`
          : (previewResult.error ?? 'Failed to preview deletion. Please try again later.');
      logger.warn(
        { userId, personalityInput, status: previewResult.status },
        '[Memory] Delete preview failed'
      );
      await context.editReply({ content: `❌ ${errorMessage}` });
      return;
    }

    const preview = previewResult.data;

    // Nothing to delete
    if (preview.wouldDelete === 0) {
      await context.editReply({
        content: `No memories found matching the criteria for **${escapeMarkdown(preview.personalityName)}**.`,
      });
      return;
    }

    // Build confirmation embed
    const timeframeDisplay = formatTimeframe(timeframe);
    let description = `You are about to delete **${preview.wouldDelete}** memories for **${escapeMarkdown(preview.personalityName)}**`;

    if (timeframe !== null) {
      description += ` from the last **${timeframeDisplay}**`;
    }

    description += '.';

    if (preview.lockedWouldSkip > 0) {
      description += `\n\n**${preview.lockedWouldSkip}** locked (core) memories will be preserved.`;
    }

    description += '\n\n**This action cannot be undone.**';

    const embed = createWarningEmbed('Confirm Deletion', description);

    // Create confirmation buttons
    const confirmButton = new ButtonBuilder()
      .setCustomId('memory_batch_delete_confirm')
      .setLabel(`Delete ${preview.wouldDelete} Memories`)
      .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
      .setCustomId('memory_batch_delete_cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

    const response = await context.editReply({
      embeds: [embed],
      components: [row],
    });

    // Wait for button interaction
    try {
      const buttonInteraction = await response.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i: ButtonInteraction) => i.user.id === userId,
        time: CONFIRMATION_TIMEOUT,
      });

      if (buttonInteraction.customId === 'memory_batch_delete_cancel') {
        await buttonInteraction.update({
          content: 'Deletion cancelled.',
          embeds: [],
          components: [],
        });
        return;
      }

      // User confirmed - perform deletion
      await buttonInteraction.deferUpdate();

      const deleteResult = await callGatewayApi<DeleteResponse>('/user/memory/delete', {
        userId,
        method: 'POST',
        body: {
          personalityId,
          timeframe,
        },
      });

      if (!deleteResult.ok) {
        await buttonInteraction.editReply({
          content: `Failed to delete memories: ${deleteResult.error ?? 'Unknown error'}`,
          embeds: [],
          components: [],
        });
        return;
      }

      const result = deleteResult.data;

      // Show success
      let successDescription = `Deleted **${result.deletedCount}** memories for **${escapeMarkdown(result.personalityName)}**`;

      if (timeframe !== null) {
        successDescription += ` from the last **${timeframeDisplay}**`;
      }

      successDescription += '.';

      if (result.skippedLocked > 0) {
        successDescription += `\n\n**${result.skippedLocked}** locked memories were preserved.`;
      }

      const successEmbed = createSuccessEmbed('Memories Deleted', successDescription);

      await buttonInteraction.editReply({
        embeds: [successEmbed],
        components: [],
      });

      logger.info(
        {
          userId,
          personalityId,
          timeframe,
          deletedCount: result.deletedCount,
          skippedLocked: result.skippedLocked,
        },
        '[Memory] Batch delete completed'
      );
    } catch {
      // Timeout or error - clear components
      await context.editReply({
        content: 'Deletion cancelled - confirmation timed out.',
        embeds: [],
        components: [],
      });
    }
  } catch (error) {
    logger.error({ error, userId }, '[Memory Batch Delete] Unexpected error');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}
