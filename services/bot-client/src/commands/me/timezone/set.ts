/**
 * Timezone Set Handler
 * Handles /me timezone set command
 */

import { createLogger, TIMEZONE_DISCORD_CHOICES } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';
import { createSuccessEmbed } from '../../../utils/commandHelpers.js';
import { getCurrentTimeInTimezone, type TimezoneResponse } from './utils.js';

const logger = createLogger('timezone-set');

/**
 * Handle /me timezone set
 */
export async function handleTimezoneSet(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const timezone = context.interaction.options.getString('timezone', true);

  try {
    const result = await callGatewayApi<TimezoneResponse>('/user/timezone', {
      method: 'PUT',
      userId,
      body: { timezone },
    });

    if (!result.ok) {
      logger.warn({ userId, timezone, status: result.status }, '[Timezone] Failed to set timezone');
      await context.editReply({ content: `❌ Failed to set timezone: ${result.error}` });
      return;
    }

    const data = result.data;

    // Find the label for the timezone
    const tzChoice = TIMEZONE_DISCORD_CHOICES.find(tz => tz.value === timezone);
    const displayName = tzChoice?.name ?? data.label ?? timezone;

    const embed = createSuccessEmbed(
      '⏰ Timezone Updated',
      `Your timezone has been set to **${displayName}**`
    )
      .addFields({
        name: 'Current Time',
        value: getCurrentTimeInTimezone(timezone),
        inline: false,
      })
      .setFooter({ text: 'This affects how dates and times are displayed to you' })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, timezone }, '[Timezone] Timezone updated successfully');
  } catch (error) {
    logger.error({ err: error, userId, command: 'Timezone Set' }, '[Timezone Set] Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
