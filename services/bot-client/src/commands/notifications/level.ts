/**
 * Notifications Level Handler
 * Handles /notifications level
 */

import { NotifyLevelSchema } from '@tzurot/common-types/schemas/api/notifications';
import { notificationsLevelOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { createSuccessEmbed } from '../../utils/commandHelpers.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { LEVEL_EXPLANATION, LEVEL_LABELS, NOTIFICATIONS_RESOURCE } from './messages.js';

const logger = createLogger('notifications-level');

const FAILED_ACTION = 'update your notification level';

/** Handle /notifications level */
export async function handleNotificationsLevel(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const options = notificationsLevelOptions(context.interaction);
    // Discord restricts the option to the declared choices; the parse narrows
    // the type (inside the try so even an impossible mismatch renders through
    // this file's own error path).
    const level = NotifyLevelSchema.parse(options.level());
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.updateNotificationPrefs({ level });

    if (!result.ok) {
      logger.warn({ userId, level, status: result.status }, 'Failed to set notification level');
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(result, NOTIFICATIONS_RESOURCE, { failedAction: FAILED_ACTION })
        ),
      });
      return;
    }

    const embed = createSuccessEmbed(
      '🔔 Notification Level Updated',
      `Your level is now **${LEVEL_LABELS[result.data.level]}**.`
    )
      .addFields({ name: 'How levels work', value: LEVEL_EXPLANATION, inline: false })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error({ err: error, userId, command: 'Notifications Level' }, 'Error');
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, NOTIFICATIONS_RESOURCE, { failedAction: FAILED_ACTION })
      ),
    });
  }
}
