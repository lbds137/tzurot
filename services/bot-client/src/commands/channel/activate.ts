/**
 * Channel Activate Subcommand
 * Handles /channel activate <personality>
 *
 * Activates a personality in the current channel so it responds
 * to ALL messages without requiring @mentions.
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { channelActivateOptions } from '@tzurot/common-types/generated/commandOptions';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../utils/apiCheck.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { requireManageMessagesContext } from '../../utils/permissions.js';
import { invalidateChannelSettingsCache } from '../../utils/gatewayServiceCalls.js';
import { getChannelActivationCacheInvalidationService } from '../../services/serviceRegistry.js';
import { escapeMarkdown } from 'discord.js';

const logger = createLogger('channel-activate');

/**
 * Invalidate channel settings cache locally and across all instances
 */
async function invalidateSettingsCache(channelId: string): Promise<void> {
  invalidateChannelSettingsCache(channelId);

  try {
    const invalidationService = getChannelActivationCacheInvalidationService();
    await invalidationService.invalidateChannel(channelId);
  } catch (pubsubError) {
    logger.warn({ err: pubsubError, channelId }, 'Failed to publish invalidation event');
  }
}

/**
 * Handle /channel activate command
 *
 * @param context - DeferredCommandContext (already deferred by framework)
 */
export async function handleActivate(context: DeferredCommandContext): Promise<void> {
  const options = channelActivateOptions(context.interaction);
  const personalitySlug = options.character();
  const { channelId, guildId } = context;

  if (isAutocompleteErrorSentinel(personalitySlug)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }

  // Check permission using context-aware utility
  if (!(await requireManageMessagesContext(context))) {
    return;
  }

  // Guild ID is required (permission check ensures we're in a guild)
  if (guildId === null) {
    await context.editReply(
      renderSpec(CATALOG.error.validation('This command can only be used in a server.'))
    );
    return;
  }

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.activateChannel({
      channelId,
      personalitySlug,
      guildId,
    });

    if (!result.ok) {
      logger.warn(
        {
          userId: context.user.id,
          channelId,
          personalitySlug,
          error: result.error,
          status: result.status,
        },
        'Activation failed'
      );

      // Handle specific error cases
      if (result.status === 404) {
        await context.editReply(
          renderSpec(
            CATALOG.error.notFound('Character', {
              name: escapeMarkdown(personalitySlug),
              autocomplete: true,
            })
          )
        );
        return;
      }

      if (result.status === 403) {
        await context.editReply(
          renderSpec(
            CATALOG.error.permissionDenied(
              `access **${escapeMarkdown(personalitySlug)}** — you can only activate characters that are public or that you own`
            )
          )
        );
        return;
      }

      await context.editReply(
        renderSpec(
          classifyGatewayFailure(result, 'channel', { failedAction: 'activate the channel' })
        )
      );
      return;
    }

    const { activation, replaced } = result.data;
    const replacedNote = replaced ? ' (replaced previous activation)' : '';

    // Invalidate cache locally and across all bot-client instances
    await invalidateSettingsCache(channelId);

    await context.editReply(
      `✅ Activated **${activation.personalityName}** in this channel${replacedNote}.\n\n` +
        `All messages in <#${channelId}> will now get responses from this character.`
    );

    logger.info(
      {
        userId: context.user.id,
        channelId,
        guildId,
        personalitySlug: activation.personalitySlug,
        activationId: activation.id,
        replaced,
      },
      'Personality activated'
    );
  } catch (error) {
    logger.error(
      {
        err: error,
        userId: context.user.id,
        channelId,
        personalitySlug,
      },
      'Activation error'
    );
    await context.editReply(
      renderSpec(classifyGatewayFailure(error, 'channel', { failedAction: 'activate the channel' }))
    );
  }
}
