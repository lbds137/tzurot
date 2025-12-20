/**
 * Timezone Get Handler
 * Handles /me timezone get command
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, TIMEZONE_DISCORD_CHOICES } from '@tzurot/common-types';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';
import {
  replyWithError,
  handleCommandError,
  createInfoEmbed,
} from '../../../utils/commandHelpers.js';
import { getCurrentTimeInTimezone, type TimezoneResponse } from './utils.js';

const logger = createLogger('timezone-get');

/**
 * Handle /me timezone get
 */
export async function handleTimezoneGet(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;

  try {
    const result = await callGatewayApi<TimezoneResponse>('/user/timezone', { userId });

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, '[Timezone] Failed to get timezone');
      await replyWithError(interaction, 'Failed to get timezone. Please try again later.');
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

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'Timezone Get' });
  }
}
