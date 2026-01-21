/**
 * Channel Deactivate Subcommand
 * Handles /channel deactivate
 *
 * Deactivates any personality from the current channel,
 * stopping auto-responses.
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { createLogger, type DeactivateChannelResponse } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { requireManageMessagesContext } from '../../utils/permissions.js';
import { invalidateChannelSettingsCache } from '../../utils/GatewayClient.js';
import { getChannelActivationCacheInvalidationService } from '../../services/serviceRegistry.js';

const logger = createLogger('channel-deactivate');

/**
 * Handle /channel deactivate command
 *
 * @param context - DeferredCommandContext (already deferred by framework)
 */
export async function handleDeactivate(context: DeferredCommandContext): Promise<void> {
  const { channelId } = context;

  // Check permission using context-aware utility
  if (!(await requireManageMessagesContext(context))) {
    return;
  }

  try {
    const result = await callGatewayApi<DeactivateChannelResponse>('/user/channel/deactivate', {
      userId: context.user.id,
      method: 'DELETE',
      body: {
        channelId,
      },
    });

    if (!result.ok) {
      logger.warn(
        {
          userId: context.user.id,
          channelId,
          error: result.error,
          status: result.status,
        },
        '[Channel] Deactivation failed'
      );

      await context.editReply(`❌ Failed to deactivate: ${result.error}`);
      return;
    }

    const { deactivated, personalityName } = result.data;

    // Invalidate local cache
    invalidateChannelSettingsCache(channelId);

    // Publish invalidation event to all bot-client instances via Redis pub/sub
    // This ensures horizontal scaling works correctly
    try {
      const invalidationService = getChannelActivationCacheInvalidationService();
      await invalidationService.invalidateChannel(channelId);
    } catch (pubsubError) {
      // Log but don't fail the command - local invalidation already happened
      logger.warn(
        { err: pubsubError, channelId },
        '[Channel] Failed to publish invalidation event'
      );
    }

    if (!deactivated) {
      await context.editReply(
        '📍 No personality is currently activated in this channel.\n\n' +
          'Use `/channel activate` to activate one.'
      );
      return;
    }

    await context.editReply(
      `✅ Deactivated **${personalityName}** from this channel.\n\n` +
        'The channel will no longer auto-respond to messages.'
    );

    logger.info(
      {
        userId: context.user.id,
        channelId,
        personalityName,
      },
      '[Channel] Personality deactivated'
    );
  } catch (error) {
    logger.error(
      {
        err: error,
        userId: context.user.id,
        channelId,
      },
      '[Channel] Deactivation error'
    );
    await context.editReply('❌ An unexpected error occurred while deactivating the channel.');
  }
}
