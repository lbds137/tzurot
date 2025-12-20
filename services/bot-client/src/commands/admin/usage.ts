/**
 * Admin Usage Subcommand
 * Handles /admin usage - Shows global usage statistics across all users
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { adminFetch } from '../../utils/adminApiClient.js';
import { buildAdminUsageEmbed, type AdminUsageStats } from '../../utils/usageFormatter.js';

const logger = createLogger('admin-usage');

export async function handleUsage(interaction: ChatInputCommandInteraction): Promise<void> {
  // Note: deferReply is handled by top-level interactionCreate handler
  const periodOption = interaction.options.getString('period');
  const timeframe =
    periodOption !== undefined && periodOption !== null && periodOption.length > 0
      ? periodOption
      : '7d';

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

    const stats = (await response.json()) as AdminUsageStats;
    const embed = buildAdminUsageEmbed(stats);

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      { timeframe, totalRequests: stats.totalRequests, uniqueUsers: stats.uniqueUsers },
      '[AdminUsage] Returned stats'
    );
  } catch (error) {
    logger.error({ err: error }, 'Error retrieving usage statistics');
    await interaction.editReply('❌ Error retrieving usage statistics. Please try again later.');
  }
}
