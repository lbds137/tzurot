/**
 * Timezone View Handler
 * Handles /settings timezone view command
 */

import { timezoneDisplayName } from '@tzurot/common-types/constants/timezone';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { createInfoEmbed } from '../../../utils/commandHelpers.js';
import { getCurrentTimeInTimezone } from './utils.js';
import { classifyGatewayFailure } from '../../../ux/catalog/classify.js';
import { renderSpec } from '../../../ux/render/render.js';

const logger = createLogger('timezone-view');

/**
 * Handle /settings timezone view
 */
export async function handleTimezoneView(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.getTimezone();

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, 'Failed to get timezone');
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(result, 'timezone', {
            operation: 'read',
            failedAction: 'fetch your timezone',
          })
        ),
      });
      return;
    }

    const data = result.data;

    // Known zones render '<label> - <offset>'; an unlisted zone falls back to
    // its raw IANA value, as before.
    const displayName = timezoneDisplayName(data.timezone);

    const description =
      data.isDefault === true
        ? `You're using the default timezone: **${displayName}**\n\nUse \`/settings timezone set\` to change it.`
        : `Your timezone is set to: **${displayName}**`;

    const embed = createInfoEmbed('⏰ Your Timezone', description)
      .addFields({
        name: 'Current Time',
        value: getCurrentTimeInTimezone(data.timezone),
        inline: false,
      })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error({ err: error, userId, command: 'Timezone View' }, 'Error');
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, 'timezone', {
          operation: 'read',
          failedAction: 'fetch your timezone',
        })
      ),
    });
  }
}
