/**
 * Admin Usage Subcommand
 * Handles /admin usage - Shows global usage statistics across all users
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { createLogger } from '@tzurot/common-types';
import { adminFetch } from '../../utils/adminApiClient.js';
import { buildAdminUsageEmbed, type AdminUsageStats } from '../../utils/usageFormatter.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const logger = createLogger('admin-usage');

export async function handleUsage(context: DeferredCommandContext): Promise<void> {
  const periodOption = context.getOption<string>('period');
  const timeframe =
    periodOption !== undefined && periodOption !== null && periodOption.length > 0
      ? periodOption
      : '7d';

  try {
    const response = await adminFetch(`/admin/usage?timeframe=${timeframe}`);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Usage query failed');

      await context.editReply({
        content: `❌ Failed to retrieve usage statistics (HTTP ${response.status}):\n\`\`\`\n${errorText}\n\`\`\``,
      });
      return;
    }

    const stats = (await response.json()) as AdminUsageStats;
    const embed = buildAdminUsageEmbed(stats);

    await context.editReply({ embeds: [embed] });

    logger.info(
      { timeframe, totalRequests: stats.totalRequests, uniqueUsers: stats.uniqueUsers },
      '[AdminUsage] Returned stats'
    );
  } catch (error) {
    logger.error({ err: error }, 'Error retrieving usage statistics');
    await context.editReply({
      content: '❌ Error retrieving usage statistics. Please try again later.',
    });
  }
}
