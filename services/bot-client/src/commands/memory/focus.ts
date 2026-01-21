/**
 * Memory Focus Mode Handlers
 * Handles /memory focus enable|disable|status commands
 *
 * Focus Mode disables LTM retrieval without deleting memories.
 * Memories continue to be saved, but won't be retrieved during conversations.
 */

import { escapeMarkdown } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { createSuccessEmbed, createInfoEmbed } from '../../utils/commandHelpers.js';
import { resolvePersonalityId, getPersonalityName } from './autocomplete.js';

const logger = createLogger('memory-focus');

interface FocusResponse {
  personalityId: string;
  personalityName: string;
  focusModeEnabled: boolean;
  message?: string;
}

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
  const personalityInput = context.interaction.options.getString('personality', true);

  try {
    // Resolve personality slug to ID
    const personalityId = await resolvePersonalityId(userId, personalityInput);

    if (personalityId === null) {
      await context.editReply({
        content: `❌ Personality "${personalityInput}" not found. Use autocomplete to select a valid personality.`,
      });
      return;
    }

    const result = await callGatewayApi<FocusResponse>(
      `/user/memory/focus?personalityId=${personalityId}`,
      {
        userId,
        method: 'GET',
      }
    );

    if (!result.ok) {
      logger.warn(
        { userId, personalityInput, status: result.status },
        '[Memory/Focus] Status check failed'
      );
      await context.editReply({
        content: '❌ Failed to check focus mode status. Please try again.',
      });
      return;
    }

    const data = result.data;
    const personalityName = await getPersonalityName(userId, personalityId);

    const embed = createInfoEmbed(
      'Focus Mode Status',
      data.focusModeEnabled
        ? `Focus mode is **enabled** for **${escapeMarkdown(personalityName ?? personalityInput)}**.\n\nLong-term memories are not being retrieved during conversations. New memories are still being saved.`
        : `Focus mode is **disabled** for **${escapeMarkdown(personalityName ?? personalityInput)}**.\n\nLong-term memories are being retrieved normally during conversations.`
    );

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, personalityId, focusModeEnabled: data.focusModeEnabled },
      '[Memory/Focus] Status checked'
    );
  } catch (error) {
    logger.error({ error, userId }, '[Memory/Focus Status] Unexpected error');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}

/**
 * Common handler for enabling/disabling focus mode
 */
async function setFocusMode(context: DeferredCommandContext, enabled: boolean): Promise<void> {
  const userId = context.user.id;
  const personalityInput = context.interaction.options.getString('personality', true);

  try {
    // Resolve personality slug to ID
    const personalityId = await resolvePersonalityId(userId, personalityInput);

    if (personalityId === null) {
      await context.editReply({
        content: `❌ Personality "${personalityInput}" not found. Use autocomplete to select a valid personality.`,
      });
      return;
    }

    const result = await callGatewayApi<FocusResponse>('/user/memory/focus', {
      userId,
      method: 'POST',
      body: { personalityId, enabled },
    });

    if (!result.ok) {
      logger.warn(
        { userId, personalityInput, enabled, status: result.status },
        '[Memory/Focus] Set focus mode failed'
      );
      await context.editReply({ content: '❌ Failed to update focus mode. Please try again.' });
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
      `[Memory/Focus] Focus mode ${enabled ? 'enabled' : 'disabled'}`
    );
  } catch (error) {
    logger.error(
      { error, userId },
      `[Memory/Focus ${enabled ? 'Enable' : 'Disable'}] Unexpected error`
    );
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}
