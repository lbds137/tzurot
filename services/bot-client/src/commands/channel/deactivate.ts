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

import { createLogger } from '@tzurot/common-types/utils/logger';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { requireManageMessagesContext } from '../../utils/permissions.js';
import { invalidateChannelSettingsCache } from '../../utils/gatewayServiceCalls.js';
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
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.deactivateChannel({ channelId });

    if (!result.ok) {
      logger.warn(
        {
          userId: context.user.id,
          channelId,
          error: result.error,
          status: result.status,
        },
        'Deactivation failed'
      );

      await context.editReply(
        renderSpec(
          classifyGatewayFailure(result, 'channel', { failedAction: 'deactivate the channel' })
        )
      );
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
      logger.warn({ err: pubsubError, channelId }, 'Failed to publish invalidation event');
    }

    if (!deactivated) {
      await context.editReply(
        '📍 No character is currently activated in this channel.\n\n' +
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
      'Personality deactivated'
    );
  } catch (error) {
    logger.error(
      {
        err: error,
        userId: context.user.id,
        channelId,
      },
      'Deactivation error'
    );
    await context.editReply(
      renderSpec(
        classifyGatewayFailure(error, 'channel', { failedAction: 'deactivate the channel' })
      )
    );
  }
}
