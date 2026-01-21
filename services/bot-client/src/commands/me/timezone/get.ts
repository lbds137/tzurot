/**
 * Timezone Get Handler
 * Handles /me timezone get command
 */

import { createLogger, TIMEZONE_DISCORD_CHOICES } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';
import { createInfoEmbed } from '../../../utils/commandHelpers.js';
import { getCurrentTimeInTimezone, type TimezoneResponse } from './utils.js';

const logger = createLogger('timezone-get');

/**
 * Handle /me timezone get
 */
export async function handleTimezoneGet(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const result = await callGatewayApi<TimezoneResponse>('/user/timezone', { userId });

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, '[Timezone] Failed to get timezone');
      await context.editReply({ content: '❌ Failed to get timezone. Please try again later.' });
      return;
    }

    const data = result.data;

    // Find the label for the timezone
    const tzChoice = TIMEZONE_DISCORD_CHOICES.find(tz => tz.value === data.timezone);
    const displayName = tzChoice?.name ?? data.timezone;

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
    logger.error({ err: error, userId, command: 'Timezone Get' }, '[Timezone Get] Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
