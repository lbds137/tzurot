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
  type ChatInputCommandInteraction,
  type ButtonInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import {
  replyWithError,
  handleCommandError,
  createWarningEmbed,
  createSuccessEmbed,
} from '../../utils/commandHelpers.js';
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

/** Format timeframe for display */
function formatTimeframe(timeframe: string | null): string {
  if (timeframe === null) {
    return 'all time';
  }

  const match = /^(\d+)(h|d|y)$/.exec(timeframe);
  if (!match) {
    return timeframe;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'h':
      return value === 1 ? '1 hour' : `${value} hours`;
    case 'd':
      return value === 1 ? '1 day' : `${value} days`;
    case 'y':
      return value === 1 ? '1 year' : `${value} years`;
    default:
      return timeframe;
  }
}

/**
 * Handle /memory delete
 * Shows preview and confirmation before batch deleting
 */
// eslint-disable-next-line max-lines-per-function, max-statements -- Discord command handler with sequential UI flow
export async function handleBatchDelete(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const personalityInput = interaction.options.getString('personality', true);
  const timeframe = interaction.options.getString('timeframe');

  try {
    // Resolve personality slug to ID
    const personalityId = await resolvePersonalityId(userId, personalityInput);

    if (personalityId === null) {
      await replyWithError(
        interaction,
        `Personality "${personalityInput}" not found. Use autocomplete to select a valid personality.`
      );
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
      await replyWithError(interaction, errorMessage);
      return;
    }

    const preview = previewResult.data;

    // Nothing to delete
    if (preview.wouldDelete === 0) {
      await interaction.editReply({
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

    const response = await interaction.editReply({
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
      await interaction.editReply({
        content: 'Deletion cancelled - confirmation timed out.',
        embeds: [],
        components: [],
      });
    }
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'Memory Delete' });
  }
}
