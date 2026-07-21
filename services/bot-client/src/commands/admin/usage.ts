/**
 * Admin Usage Subcommand
 * Handles /admin usage - Shows global usage statistics across all users
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { adminUsageOptions } from '@tzurot/common-types/generated/commandOptions';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { clientsFor } from '../../utils/gatewayClients.js';
import { buildAdminUsageEmbed } from '../../utils/usageFormatter.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const logger = createLogger('admin-usage');

export async function handleUsage(context: DeferredCommandContext): Promise<void> {
  const options = adminUsageOptions(context.interaction);
  const periodOption = options.timeframe();
  const timeframe =
    periodOption !== undefined && periodOption !== null && periodOption.length > 0
      ? periodOption
      : '7d';

  try {
    const { ownerClient } = clientsFor(context.interaction);
    const result = await ownerClient.getAdminUsageStats({ timeframe });

    if (!result.ok) {
      logger.error({ status: result.status, error: result.error }, 'Usage query failed');

      await context.editReply({
        content: renderSpec(
          CATALOG.error.validation(
            `Failed to retrieve usage statistics (HTTP ${result.status}):\n\`\`\`\n${result.error}\n\`\`\``
          )
        ),
      });
      return;
    }

    const stats = result.data;
    const embed = buildAdminUsageEmbed(stats);

    await context.editReply({ embeds: [embed] });

    logger.info(
      { timeframe, totalRequests: stats.totalRequests, uniqueUsers: stats.uniqueUsers },
      'Returned stats'
    );
  } catch (error) {
    logger.error({ err: error }, 'Error retrieving usage statistics');
    await context.editReply({
      content: renderSpec(CATALOG.error.operationFailed('retrieve usage statistics')),
    });
  }
}
