/**
 * Notifications Toggle Handlers
 * Handles /notifications enable and /notifications disable
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { createSuccessEmbed } from '../../utils/commandHelpers.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { NOTIFICATIONS_RESOURCE } from './messages.js';

const logger = createLogger('notifications-toggle');

async function setEnabled(context: DeferredCommandContext, enabled: boolean): Promise<void> {
  const userId = context.user.id;
  const failedAction = enabled ? 'enable release-notes DMs' : 'disable release-notes DMs';

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.updateNotificationPrefs({ enabled });

    if (!result.ok) {
      logger.warn(
        { userId, enabled, status: result.status },
        'Failed to update notification prefs'
      );
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(result, NOTIFICATIONS_RESOURCE, { failedAction })
        ),
      });
      return;
    }

    const embed = createSuccessEmbed(
      '🔔 Release Notifications',
      result.data.enabled
        ? 'Release-notes DMs are **on**. You can tune the weight with `/notifications level`.'
        : 'Release-notes DMs are **off**. Use `/notifications enable` any time to turn them back on.'
    ).setTimestamp();

    await context.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error({ err: error, userId, command: 'Notifications Toggle' }, 'Error');
    await context.editReply({
      content: renderSpec(classifyGatewayFailure(error, NOTIFICATIONS_RESOURCE, { failedAction })),
    });
  }
}

/** Handle /notifications enable */
export async function handleNotificationsEnable(context: DeferredCommandContext): Promise<void> {
  await setEnabled(context, true);
}

/** Handle /notifications disable */
export async function handleNotificationsDisable(context: DeferredCommandContext): Promise<void> {
  await setEnabled(context, false);
}
