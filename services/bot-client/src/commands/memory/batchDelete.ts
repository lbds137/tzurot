/**
 * Batch Delete Handler
 * Handles /memory delete command - batch delete memories with filters
 * Uses a confirmation flow with danger button
 */

import { ComponentType, escapeMarkdown, type ButtonInteraction } from 'discord.js';
import { memoryDeleteOptions } from '@tzurot/common-types/generated/commandOptions';
import { Duration, DurationParseError } from '@tzurot/common-types/utils/Duration';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { createSuccessEmbed } from '../../utils/commandHelpers.js';
import { buildConfirmAction } from '../../utils/confirmation/confirmAction.js';
import { resolveRequiredPersonality } from './resolveHelpers.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { ackUpdate } from '../../ux/render/reply.js';

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

const CANCELLED_MESSAGE = 'Deletion cancelled.';

/**
 * Render the outer-catch outcome for `handleBatchDelete`, phase-aware so the
 * message always matches what actually happened to the write. Extracted to
 * keep the handler's own cognitive complexity within the lint budget —
 * the branching lives here instead of inline in the catch block.
 */
async function renderBatchDeleteCatchOutcome(
  phase: 'read' | 'cancelled' | 'confirm' | 'applied',
  error: unknown,
  userId: string,
  context: DeferredCommandContext
): Promise<void> {
  if (phase === 'applied') {
    // The delete already committed before this throw — the render/delivery
    // step is what failed. Must NOT read as cancelled or failed, or the
    // user retries a deletion that already happened.
    logger.error({ err: error, userId, phase }, 'Batch delete applied but result render failed');
    await context.editReply({
      content: renderSpec(
        CATALOG.error.destructiveApplied(
          'The memories were deleted',
          'Use /memory browse to verify.'
        )
      ),
      embeds: [],
      components: [],
    });
    return;
  }

  if (phase === 'cancelled') {
    // The user cancelled and no write will happen — only the cancel ack
    // failed to render. Confirm the cancellation on the fallback surface
    // (which also clears the stale confirm buttons); a failure message here
    // would invite retrying a deletion the user just declined.
    logger.error({ err: error, userId, phase }, 'Batch delete cancel ack render failed');
    await context.editReply({
      content: CANCELLED_MESSAGE,
      embeds: [],
      components: [],
    });
    return;
  }

  if (phase === 'confirm') {
    // Confirmed but the flow around the write (ack, result render) threw
    // before completing — nothing was written (the client itself never
    // throws), so classify as a failure rather than a timeout/cancellation.
    // Clear the stale confirm embed/buttons like the sibling branches.
    logger.error({ err: error, userId, phase }, 'Unexpected error');
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, 'memories', { failedAction: 'complete the deletion' })
      ),
      embeds: [],
      components: [],
    });
    return;
  }

  // Still in the resolve/preview READ phase — nothing was written.
  logger.error({ err: error, userId, phase }, 'Unexpected error');
  await context.editReply({
    content: renderSpec(classifyGatewayFailure(error, 'memories', { operation: 'read' })),
  });
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

  // Tracks how far the flow got before an outer-catch throw, so the catch
  // can render an outcome-honest message: 'applied' means the delete already
  // happened, so the catch must never claim it was cancelled or failed.
  let phase: 'read' | 'cancelled' | 'confirm' | 'applied' = 'read';

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
      logger.warn(
        { userId, personalityInput, status: previewResult.status },
        'Delete preview failed'
      );
      await context.editReply({
        content:
          previewResult.status === 404
            ? renderSpec(
                CATALOG.error.notFound('Character', { name: escapeMarkdown(personalityInput) })
              )
            : renderSpec(
                classifyGatewayFailure(previewResult, 'deletion preview', { operation: 'read' })
              ),
      });
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

    const { embed, components } = buildConfirmAction({
      title: 'Confirm Deletion',
      description,
      confirmCustomId: 'memory-batch-delete::confirm',
      cancelCustomId: 'memory-batch-delete::cancel',
      confirmLabel: `Delete ${preview.wouldDelete} Memories`,
      confirmEmoji: '🗑️',
    });

    const response = await context.editReply({
      embeds: [embed],
      components,
    });

    // Wait for button interaction. Narrowly scoped: only a collector-wait
    // failure (an actual timeout) may render the "confirmation timed out"
    // message — everything past this point has its own phase-aware handling.
    let buttonInteraction: ButtonInteraction;
    try {
      // eslint-disable-next-line no-restricted-syntax -- Secondary collector inside an exported handler — documented exception in `.claude/rules/04-discord.md`. The customIds use the `command::action::id` format and the parent flow IS routed through CommandHandler; this collector is just the timeout-bounded confirmation wait.
      buttonInteraction = await response.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i: ButtonInteraction) => i.user.id === userId,
        time: CONFIRMATION_TIMEOUT,
      });
    } catch {
      // Timeout - clear components
      await context.editReply({
        content: 'Deletion cancelled - confirmation timed out.',
        embeds: [],
        components: [],
      });
      return;
    }

    if (buttonInteraction.customId === 'memory-batch-delete::cancel') {
      // 'cancelled' before the ack: a throw during the ack must confirm the
      // cancellation, never render a delete-failure (nothing will be written).
      phase = 'cancelled';
      await buttonInteraction.update({
        content: CANCELLED_MESSAGE,
        embeds: [],
        components: [],
      });
      return;
    }

    // User confirmed - perform deletion
    phase = 'confirm';
    await ackUpdate(buttonInteraction);

    const deleteResult = await userClient.batchDelete({ previewToken: preview.previewToken });

    if (!deleteResult.ok) {
      await buttonInteraction.editReply({
        content: renderSpec(
          classifyGatewayFailure(deleteResult, 'memories', {
            failedAction: 'delete the memories',
          })
        ),
        embeds: [],
        components: [],
      });
      return;
    }

    // The write has applied — from here on, a throw must never render as
    // cancelled or failed; only the render/delivery step can still fail.
    phase = 'applied';

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

    await buttonInteraction.editReply({
      embeds: [successEmbed],
      components: [],
    });
  } catch (error) {
    await renderBatchDeleteCatchOutcome(phase, error, userId, context);
  }
}
