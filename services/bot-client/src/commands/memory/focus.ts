/**
 * Memory Focus Mode Handlers
 * Handles /memory focus enable|disable|status commands
 *
 * Focus Mode disables LTM retrieval without deleting memories.
 * Memories continue to be saved, but won't be retrieved during conversations.
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { escapeMarkdown } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import {
  replyWithError,
  handleCommandError,
  createSuccessEmbed,
  createInfoEmbed,
} from '../../utils/commandHelpers.js';
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
export async function handleFocusEnable(interaction: ChatInputCommandInteraction): Promise<void> {
  await setFocusMode(interaction, true);
}

/**
 * Handle /memory focus disable
 */
export async function handleFocusDisable(interaction: ChatInputCommandInteraction): Promise<void> {
  await setFocusMode(interaction, false);
}

/**
 * Handle /memory focus status
 */
export async function handleFocusStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const personalityInput = interaction.options.getString('personality', true);

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
      await replyWithError(interaction, 'Failed to check focus mode status. Please try again.');
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

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      { userId, personalityId, focusModeEnabled: data.focusModeEnabled },
      '[Memory/Focus] Status checked'
    );
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'Memory Focus Status' });
  }
}

/**
 * Common handler for enabling/disabling focus mode
 */
async function setFocusMode(
  interaction: ChatInputCommandInteraction,
  enabled: boolean
): Promise<void> {
  const userId = interaction.user.id;
  const personalityInput = interaction.options.getString('personality', true);

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
      await replyWithError(interaction, 'Failed to update focus mode. Please try again.');
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

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      { userId, personalityId, enabled },
      `[Memory/Focus] Focus mode ${enabled ? 'enabled' : 'disabled'}`
    );
  } catch (error) {
    await handleCommandError(interaction, error, {
      userId,
      command: `Memory Focus ${enabled ? 'Enable' : 'Disable'}`,
    });
  }
}
