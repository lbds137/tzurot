/**
 * Memory Focus Mode Handlers
 * Handles /memory focus enable|disable|status commands
 *
 * Focus Mode disables LTM retrieval without deleting memories.
 * Memories continue to be saved, but won't be retrieved during conversations.
 */

import { escapeMarkdown } from 'discord.js';
import {
  memoryFocusEnableOptions,
  memoryFocusDisableOptions,
  memoryFocusStatusOptions,
} from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { createSuccessEmbed, createInfoEmbed } from '../../utils/commandHelpers.js';
import { getPersonalityName } from './autocomplete.js';
import { resolveRequiredPersonality } from './resolveHelpers.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';

/** Shared resource + failedAction verb for the focus-mode classify paths. */
const FOCUS_RESOURCE = 'focus mode';
const UPDATE_FOCUS_ACTION = 'update focus mode';

const logger = createLogger('memory-focus');

/**
 * Handle /memory focus enable
 */
export async function handleFocusEnable(context: DeferredCommandContext): Promise<void> {
  await setFocusMode(context, true);
}

/**
 * Handle /memory focus disable
 */
export async function handleFocusDisable(context: DeferredCommandContext): Promise<void> {
  await setFocusMode(context, false);
}

/**
 * Handle /memory focus status
 */
export async function handleFocusStatus(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const { userClient } = clientsFor(context.interaction);
  const options = memoryFocusStatusOptions(context.interaction);
  const personalityInput = options.character();

  try {
    // Resolve personality slug to ID
    const personalityId = await resolveRequiredPersonality(context, userClient, personalityInput);
    if (personalityId === null) {
      return;
    }

    const result = await userClient.getFocus({ personalityId });

    if (!result.ok) {
      logger.warn({ userId, personalityInput, status: result.status }, 'Status check failed');
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(result, 'focus mode status', { operation: 'read' })
        ),
      });
      return;
    }

    const data = result.data;
    const personalityName = await getPersonalityName(userClient, personalityId);

    const embed = createInfoEmbed(
      'Focus Mode Status',
      data.focusModeEnabled
        ? `Focus mode is **enabled** for **${escapeMarkdown(personalityName ?? personalityInput)}**.\n\nLong-term memories are not being retrieved during conversations. New memories are still being saved.`
        : `Focus mode is **disabled** for **${escapeMarkdown(personalityName ?? personalityInput)}**.\n\nLong-term memories are being retrieved normally during conversations.`
    );

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, personalityId, focusModeEnabled: data.focusModeEnabled },
      'Status checked'
    );
  } catch (error) {
    logger.error({ err: error, userId }, 'Unexpected error');
    // This handler only READS (resolve + getFocus) — never claim a write.
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, 'focus mode status', { operation: 'read' })
      ),
    });
  }
}

/**
 * Common handler for enabling/disabling focus mode
 */
async function setFocusMode(context: DeferredCommandContext, enabled: boolean): Promise<void> {
  const userId = context.user.id;
  const { userClient } = clientsFor(context.interaction);
  // Both enable and disable use the same option schema
  const options = enabled
    ? memoryFocusEnableOptions(context.interaction)
    : memoryFocusDisableOptions(context.interaction);
  const personalityInput = options.character();

  try {
    // Resolve personality slug to ID
    const personalityId = await resolveRequiredPersonality(context, userClient, personalityInput);
    if (personalityId === null) {
      return;
    }

    const result = await userClient.setFocus({ personalityId, enabled });

    if (!result.ok) {
      logger.warn(
        { userId, personalityInput, enabled, status: result.status },
        'Set focus mode failed'
      );
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(result, FOCUS_RESOURCE, { failedAction: UPDATE_FOCUS_ACTION })
        ),
      });
      return;
    }

    const data = result.data;

    const embed = enabled
      ? createSuccessEmbed(
          'Focus Mode Enabled',
          `Focus mode is now **enabled** for **${escapeMarkdown(data.personalityName)}**.\n\nLong-term memories will not be retrieved during conversations. New memories will continue to be saved.`
        )
      : createSuccessEmbed(
          'Focus Mode Disabled',
          `Focus mode is now **disabled** for **${escapeMarkdown(data.personalityName)}**.\n\nLong-term memories will be retrieved normally during conversations.`
        );

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, personalityId, enabled },
      `Focus mode ${enabled ? 'enabled' : 'disabled'}`
    );
  } catch (error) {
    logger.error({ err: error, userId }, `Unexpected error`);
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, FOCUS_RESOURCE, { failedAction: UPDATE_FOCUS_ACTION })
      ),
    });
  }
}
