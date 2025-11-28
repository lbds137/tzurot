/**
 * Usage Command
 * Shows token usage statistics for the user
 *
 * Command: /usage [period]
 * - period: day, week, month, all (optional, defaults to month)
 */

import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, type UsagePeriod, type UsageStats } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { deferEphemeral, replyWithError, handleCommandError } from '../../utils/commandHelpers.js';
import { buildUserUsageEmbed } from '../../utils/usageFormatter.js';

const logger = createLogger('usage-command');

/**
 * Period choices for the command
 */
export const PERIOD_CHOICES: readonly { name: string; value: UsagePeriod }[] = [
  { name: 'Today', value: 'day' },
  { name: 'Last 7 days', value: 'week' },
  { name: 'Last 30 days', value: 'month' },
  { name: 'All time', value: 'all' },
];

/**
 * Slash command definition
 */
export const data = new SlashCommandBuilder()
  .setName('usage')
  .setDescription('View your token usage statistics')
  .addStringOption(option =>
    option
      .setName('period')
      .setDescription('Time period for stats')
      .setRequired(false)
      .addChoices(...PERIOD_CHOICES)
  );

/**
 * Command execution
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await handleUsage(interaction);
}

/**
 * Get period display name
 */
function getPeriodDisplayName(period: string): string {
  const choice = PERIOD_CHOICES.find(p => p.value === period);
  return choice?.name ?? period;
}

/**
 * Handle /usage command
 */
export async function handleUsage(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const period = interaction.options.getString('period') ?? 'month';

  await deferEphemeral(interaction);

  try {
    const result = await callGatewayApi<UsageStats>(`/user/usage?period=${period}`, { userId });

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, '[Usage] Failed to get usage stats');
      await replyWithError(interaction, 'Failed to get usage statistics. Please try again later.');
      return;
    }

    const stats = result.data;
    const embed = buildUserUsageEmbed(stats, getPeriodDisplayName(period));

    await interaction.editReply({ embeds: [embed] });

    logger.info({ userId, period, totalRequests: stats.totalRequests }, '[Usage] Returned stats');
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'Usage' });
  }
}
