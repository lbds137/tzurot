/**
 * Timezone Subcommand Handlers
 * Handles /timezone set and /timezone get
 */

import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { deferEphemeral, replyWithError, handleCommandError } from '../../utils/commandHelpers.js';

const logger = createLogger('timezone-command');

/**
 * Common timezone choices for Discord dropdown (max 25)
 */
export const TIMEZONE_CHOICES = [
  // Americas
  { name: 'Eastern Time (US) - UTC-5', value: 'America/New_York' },
  { name: 'Central Time (US) - UTC-6', value: 'America/Chicago' },
  { name: 'Mountain Time (US) - UTC-7', value: 'America/Denver' },
  { name: 'Pacific Time (US) - UTC-8', value: 'America/Los_Angeles' },
  { name: 'Alaska Time - UTC-9', value: 'America/Anchorage' },
  { name: 'Hawaii Time - UTC-10', value: 'Pacific/Honolulu' },
  // Europe
  { name: 'London (GMT/BST) - UTC+0', value: 'Europe/London' },
  { name: 'Central European - UTC+1', value: 'Europe/Paris' },
  { name: 'Moscow - UTC+3', value: 'Europe/Moscow' },
  // Asia
  { name: 'Dubai - UTC+4', value: 'Asia/Dubai' },
  { name: 'India Standard - UTC+5:30', value: 'Asia/Kolkata' },
  { name: 'Singapore - UTC+8', value: 'Asia/Singapore' },
  { name: 'China Standard - UTC+8', value: 'Asia/Shanghai' },
  { name: 'Japan Standard - UTC+9', value: 'Asia/Tokyo' },
  { name: 'Korea Standard - UTC+9', value: 'Asia/Seoul' },
  // Oceania
  { name: 'Sydney - UTC+10', value: 'Australia/Sydney' },
  { name: 'New Zealand - UTC+12', value: 'Pacific/Auckland' },
  // Special
  { name: 'UTC (Coordinated Universal Time)', value: 'UTC' },
] as const;

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
