/**
 * Channel Deactivate Subcommand
 * Handles /channel deactivate
 *
 * Deactivates any personality from the current channel,
 * stopping auto-responses.
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { createLogger, type DeactivateChannelResponse } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { requireManageMessagesDeferred } from '../../utils/permissions.js';
import { invalidateChannelActivationCache } from '../../utils/GatewayClient.js';

const logger = createLogger('channel-deactivate');

/**
 * Handle /channel deactivate command
 */
export async function handleDeactivate(interaction: ChatInputCommandInteraction): Promise<void> {
  const channelId = interaction.channelId;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Check permission after deferring
  if (!(await requireManageMessagesDeferred(interaction))) {
    return;
  }

  try {
    const result = await callGatewayApi<DeactivateChannelResponse>('/user/channel/deactivate', {
      userId: interaction.user.id,
      method: 'DELETE',
      body: {
        channelId,
      },
    });

    if (!result.ok) {
      logger.warn(
        {
          userId: interaction.user.id,
          channelId,
          error: result.error,
          status: result.status,
        },
        '[Channel] Deactivation failed'
      );

      await interaction.editReply(`❌ Failed to deactivate: ${result.error}`);
      return;
    }

    const { deactivated, personalityName } = result.data;

    // Invalidate cache so the change takes effect immediately
    invalidateChannelActivationCache(channelId);

    if (!deactivated) {
      await interaction.editReply(
        '📍 No personality is currently activated in this channel.\n\n' +
          'Use `/channel activate` to activate one.'
      );
      return;
    }

    await interaction.editReply(
      `✅ Deactivated **${personalityName}** from this channel.\n\n` +
        'The channel will no longer auto-respond to messages.'
    );

    logger.info(
      {
        userId: interaction.user.id,
        channelId,
        personalityName,
      },
      '[Channel] Personality deactivated'
    );
  } catch (error) {
    logger.error(
      {
        err: error,
        userId: interaction.user.id,
        channelId,
      },
      '[Channel] Deactivation error'
    );
    await interaction.editReply('❌ An unexpected error occurred while deactivating the channel.');
  }
}
