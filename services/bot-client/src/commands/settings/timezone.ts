/**
 * Timezone Subcommand Handlers
 * Handles /timezone set and /timezone get
 */

import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS, TIMEZONE_DISCORD_CHOICES } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { deferEphemeral, replyWithError, handleCommandError } from '../../utils/commandHelpers.js';

const logger = createLogger('timezone-command');

// Re-export for command registration
export const TIMEZONE_CHOICES = TIMEZONE_DISCORD_CHOICES;

/**
 * Get the current time in a timezone
 */
function getCurrentTimeInTimezone(timezone: string): string {
  try {
    return new Date().toLocaleString('en-US', {
      timeZone: timezone,
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return 'Unable to display time';
  }
}

interface TimezoneResponse {
  timezone: string;
  label?: string;
  isDefault?: boolean;
}

/**
 * Handle /timezone set
 */
export async function handleTimezoneSet(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const timezone = interaction.options.getString('timezone', true);

  await deferEphemeral(interaction);

  try {
    const result = await callGatewayApi<TimezoneResponse>('/user/timezone', {
      method: 'PUT',
      userId,
      body: { timezone },
    });

    if (!result.ok) {
      logger.warn({ userId, timezone, status: result.status }, '[Timezone] Failed to set timezone');
      await replyWithError(interaction, `Failed to set timezone: ${result.error}`);
      return;
    }

    const data = result.data;

    // Find the label for the timezone
    const tzChoice = TIMEZONE_CHOICES.find(tz => tz.value === timezone);
    const displayName = tzChoice?.name ?? data.label ?? timezone;

    const embed = new EmbedBuilder()
      .setTitle('⏰ Timezone Updated')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(`Your timezone has been set to **${displayName}**`)
      .addFields({
        name: 'Current Time',
        value: getCurrentTimeInTimezone(timezone),
        inline: false,
      })
      .setFooter({ text: 'This affects how dates and times are displayed to you' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info({ userId, timezone }, '[Timezone] Timezone updated successfully');
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'Timezone Set' });
  }
}

/**
 * Handle /timezone get
 */
export async function handleTimezoneGet(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;

  await deferEphemeral(interaction);

  try {
    const result = await callGatewayApi<TimezoneResponse>('/user/timezone', { userId });

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, '[Timezone] Failed to get timezone');
      await replyWithError(interaction, 'Failed to get timezone. Please try again later.');
      return;
    }

    const data = result.data;

    // Find the label for the timezone
    const tzChoice = TIMEZONE_CHOICES.find(tz => tz.value === data.timezone);
    const displayName = tzChoice?.name ?? data.timezone;

    const embed = new EmbedBuilder()
      .setTitle('⏰ Your Timezone')
      .setColor(DISCORD_COLORS.BLURPLE)
      .setDescription(
        data.isDefault === true
          ? `You're using the default timezone: **${displayName}**\n\nUse \`/timezone set\` to change it.`
          : `Your timezone is set to: **${displayName}**`
      )
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
