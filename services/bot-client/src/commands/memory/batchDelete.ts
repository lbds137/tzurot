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
import { memoryDeleteOptions } from '@tzurot/common-types/generated/commandOptions';
import { Duration, DurationParseError } from '@tzurot/common-types/utils/Duration';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { createWarningEmbed, createSuccessEmbed } from '../../utils/commandHelpers.js';
import { resolveRequiredPersonality } from './resolveHelpers.js';

const logger = createLogger('memory-batch-delete');

/** Timeout for confirmation buttons (60 seconds) */
const CONFIRMATION_TIMEOUT = 60_000;

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
  const { userClient } = clientsFor(context.interaction);
  const options = memoryDeleteOptions(context.interaction);
  const personalityInput = options.character();
  const timeframe = options.timeframe();

  try {
    // resolveRequiredPersonality handles the sentinel, genuine-miss ("not found"),
    // and infra-failure ("try again") cases — replying + returning null for each.
    // Kept inside the try so an unexpected throw still reaches the catch below.
    const personalityId = await resolveRequiredPersonality(context, userClient, personalityInput);
    if (personalityId === null) {
      return;
    }

    // Preview the deletion and obtain a token bound to this filter. The
    // execute call below sends ONLY the token — server-side reads the
    // filter back from Redis under the token key, so the execute path
    // is guaranteed to match what the user previewed.
    const previewResult = await userClient.batchDeletePreview({
      personalityId,
      ...(timeframe !== null && { timeframe }),
    });

    if (!previewResult.ok) {
      const errorMessage =
        previewResult.status === 404
          ? `Character "${personalityInput}" not found.`
          : (previewResult.error ?? 'Failed to preview deletion. Please try again later.');
      logger.warn(
        { userId, personalityInput, status: previewResult.status },
        'Delete preview failed'
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
      .setCustomId('memory-batch-delete::confirm')
      .setLabel(`Delete ${preview.wouldDelete} Memories`)
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
      .setCustomId('memory-batch-delete::cancel')
      .setLabel('Cancel')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

    const response = await context.editReply({
      embeds: [embed],
      components: [row],
    });

    // Wait for button interaction
    try {
      // eslint-disable-next-line no-restricted-syntax -- Secondary collector inside an exported handler — documented exception in `.claude/rules/04-discord.md`. The customIds use the `command::action::id` format and the parent flow IS routed through CommandHandler; this collector is just the timeout-bounded confirmation wait.
      const buttonInteraction = await response.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i: ButtonInteraction) => i.user.id === userId,
        time: CONFIRMATION_TIMEOUT,
      });

      if (buttonInteraction.customId === 'memory-batch-delete::cancel') {
        await buttonInteraction.update({
          content: 'Deletion cancelled.',
          embeds: [],
          components: [],
        });
        return;
      }

      // User confirmed - perform deletion
      await buttonInteraction.deferUpdate();

      const deleteResult = await userClient.batchDelete({ previewToken: preview.previewToken });

      if (!deleteResult.ok) {
        await buttonInteraction.editReply({
          content: `❌ Failed to delete memories: ${deleteResult.error ?? 'Unknown error'}`,
          embeds: [],
          components: [],
        });
        return;
      }

      const result = deleteResult.data;

      // Show success. `personalityName` is schema-optional because the gateway
      // returns the 0-result shape without it when nothing matched; in this
      // branch the preview already confirmed >0 deletions, so the fallback is
      // a defense-in-depth guard against the rare preview-to-execute race
      // (memories deleted by another session between preview and execute).
      const displayName = result.personalityName ?? preview.personalityName;
      let successDescription = `Deleted **${result.deletedCount}** memories for **${escapeMarkdown(displayName)}**`;

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
        'Batch delete completed'
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
    logger.error({ err: error, userId }, 'Unexpected error');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}
