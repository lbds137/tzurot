/**
 * Notifications View Handler
 * Handles /notifications view
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { createInfoEmbed } from '../../utils/commandHelpers.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { LEVEL_EXPLANATION, LEVEL_LABELS, NOTIFICATIONS_RESOURCE } from './messages.js';

const logger = createLogger('notifications-view');

/** Handle /notifications view */
export async function handleNotificationsView(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.getNotificationPrefs();

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, 'Failed to get notification prefs');
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(result, NOTIFICATIONS_RESOURCE, {
            operation: 'read',
            failedAction: 'load your notification settings',
          })
        ),
      });
      return;
    }

    const { enabled, level } = result.data;

    const embed = createInfoEmbed(
      '🔔 Release Notifications',
      enabled
        ? 'You receive a DM when a new release matches your level.'
        : 'Release-notes DMs are **off**. Use `/notifications enable` to turn them back on.'
    )
      .addFields(
        { name: 'Enabled', value: enabled ? 'Yes' : 'No', inline: true },
        { name: 'Level', value: LEVEL_LABELS[level], inline: true },
        { name: 'How levels work', value: LEVEL_EXPLANATION, inline: false }
      )
      .setTimestamp();

    await context.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error({ err: error, userId, command: 'Notifications View' }, 'Error');
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, NOTIFICATIONS_RESOURCE, {
          operation: 'read',
          failedAction: 'load your notification settings',
        })
      ),
    });
  }
}
