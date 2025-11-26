/**
 * Usage Command
 * Shows token usage statistics for the user
 *
 * Command: /usage [period]
 * - period: day, week, month, all (optional, defaults to month)
 */

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  type UsagePeriod,
  type UsageStats,
} from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { deferEphemeral, replyWithError, handleCommandError } from '../../utils/commandHelpers.js';

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
 * Format token count with K/M suffix for readability
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toLocaleString();
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

    // Build the embed
    const embed = new EmbedBuilder()
      .setTitle('📊 Your Usage Statistics')
      .setColor(DISCORD_COLORS.BLURPLE)
      .setDescription(`**Period:** ${getPeriodDisplayName(period)}`)
      .setTimestamp();

    // Summary section
    if (stats.totalRequests === 0) {
      embed.addFields({
        name: 'No Usage',
        value: `You haven't made any requests in this period.\n\nStart chatting with personalities to see your usage here!`,
        inline: false,
      });
    } else {
      embed.addFields(
        {
          name: 'Total Requests',
          value: stats.totalRequests.toLocaleString(),
          inline: true,
        },
        {
          name: 'Tokens In',
          value: formatTokens(stats.totalTokensIn),
          inline: true,
        },
        {
          name: 'Tokens Out',
          value: formatTokens(stats.totalTokensOut),
          inline: true,
        }
      );

      // By provider breakdown (if multiple providers)
      const providers = Object.keys(stats.byProvider);
      if (providers.length > 0) {
        const providerLines = providers
          .sort((a, b) => stats.byProvider[b].requests - stats.byProvider[a].requests)
          .slice(0, 5) // Top 5
          .map(provider => {
            const p = stats.byProvider[provider];
            return `**${provider}**: ${p.requests} req • ${formatTokens(p.tokensIn + p.tokensOut)} tokens`;
          });

        embed.addFields({
          name: 'By Provider',
          value: providerLines.join('\n'),
          inline: false,
        });
      }

      // By request type breakdown
      const requestTypes = Object.keys(stats.byRequestType);
      if (requestTypes.length > 0) {
        const typeLines = requestTypes
          .sort((a, b) => stats.byRequestType[b].requests - stats.byRequestType[a].requests)
          .map(type => {
            const t = stats.byRequestType[type];
            return `**${type}**: ${t.requests} requests`;
          });

        embed.addFields({
          name: 'By Type',
          value: typeLines.join('\n'),
          inline: false,
        });
      }

      // Top models (if any)
      const models = Object.keys(stats.byModel);
      if (models.length > 0) {
        const modelLines = models
          .sort((a, b) => stats.byModel[b].requests - stats.byModel[a].requests)
          .slice(0, 3) // Top 3 models
          .map(model => {
            const m = stats.byModel[model];
            // Shorten model names for display
            const shortModel = model.includes('/') ? model.split('/').pop() : model;
            return `**${shortModel}**: ${m.requests} req`;
          });

        embed.addFields({
          name: 'Top Models',
          value: modelLines.join('\n'),
          inline: false,
        });
      }
    }

    embed.setFooter({
      text: 'Usage is tracked for monitoring and preventing abuse',
    });

    await interaction.editReply({ embeds: [embed] });

    logger.info({ userId, period, totalRequests: stats.totalRequests }, '[Usage] Returned stats');
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'Usage' });
  }
}
