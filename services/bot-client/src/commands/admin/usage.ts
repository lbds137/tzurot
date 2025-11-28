/**
 * Admin Usage Subcommand
 * Handles /admin usage
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags, EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { adminFetch } from '../../utils/adminApiClient.js';

const logger = createLogger('admin-usage');

export async function handleUsage(interaction: ChatInputCommandInteraction): Promise<void> {
  const timeframeOption = interaction.options.getString('timeframe');
  const timeframe =
    timeframeOption !== undefined && timeframeOption !== null && timeframeOption.length > 0
      ? timeframeOption
      : '7d';

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const response = await adminFetch(`/admin/usage?timeframe=${timeframe}`);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Usage query failed');

      await interaction.editReply(
        `❌ Failed to retrieve usage statistics (HTTP ${response.status}):\n\`\`\`\n${errorText}\n\`\`\``
      );
      return;
    }

    const data = await response.json();

    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.BLURPLE)
      .setTitle('📊 API Usage Statistics')
      .setDescription(`Timeframe: **${timeframe}**`)
      .setTimestamp();

    // Add usage data fields
    if (typeof data === 'object' && data !== null) {
      const usageData = data as {
        totalRequests?: number;
        totalTokens?: number;
        estimatedCost?: number;
      };

      if (usageData.totalRequests !== undefined) {
        embed.addFields({
          name: 'Total Requests',
          value: String(usageData.totalRequests),
          inline: true,
        });
      }

      if (usageData.totalTokens !== undefined) {
        embed.addFields({
          name: 'Total Tokens',
          value: String(usageData.totalTokens),
          inline: true,
        });
      }

      if (usageData.estimatedCost !== undefined) {
        embed.addFields({
          name: 'Estimated Cost',
          value: `$${usageData.estimatedCost.toFixed(2)}`,
          inline: true,
        });
      }
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error({ err: error }, 'Error retrieving usage statistics');
    await interaction.editReply(
      '❌ Error retrieving usage statistics.\n' + 'This feature may not be implemented yet.'
    );
  }
}
