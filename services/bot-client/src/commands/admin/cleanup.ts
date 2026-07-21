/**
 * Admin Cleanup Subcommand
 * Handles /admin cleanup - Manually trigger cleanup of old conversation history and tombstones
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { CLEANUP_DEFAULTS } from '@tzurot/common-types/constants/timing';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { adminCleanupOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { clientsFor } from '../../utils/gatewayClients.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const logger = createLogger('admin-cleanup');

export async function handleCleanup(context: DeferredCommandContext): Promise<void> {
  const options = adminCleanupOptions(context.interaction);
  const daysToKeep = options.timeframe() ?? CLEANUP_DEFAULTS.DAYS_TO_KEEP_HISTORY;
  // Discord's slash-command option type comes through as `string`, but the
  // server schema enums to ('history' | 'tombstones' | 'all'). The slash
  // command itself only exposes those three choices to users, so the cast
  // is sound — the server will reject any client-side bypass anyway.
  const target = (options.target() ?? 'all') as 'history' | 'tombstones' | 'all';

  try {
    const { ownerClient } = clientsFor(context.interaction);
    const result = await ownerClient.cleanup({ daysToKeep, target });

    if (!result.ok) {
      logger.error({ status: result.status, error: result.error }, 'Cleanup failed');
      await context.editReply({
        content: renderSpec(
          CATALOG.error.validation(
            `Cleanup failed (HTTP ${result.status}):\n\`\`\`\n${result.error}\n\`\`\``
          )
        ),
      });
      return;
    }

    const data = result.data;

    const lines = [
      '✅ **Cleanup Complete**',
      '',
      `📊 **Results:**`,
      `• History messages deleted: **${data.historyDeleted}**`,
      `• Tombstones deleted: **${data.tombstonesDeleted}**`,
      `• Kept messages from last: **${data.daysKept}** days`,
      '',
      `⏱️ Completed at: ${data.timestamp}`,
    ];

    await context.editReply({ content: lines.join('\n') });

    logger.info(
      {
        historyDeleted: data.historyDeleted,
        tombstonesDeleted: data.tombstonesDeleted,
        daysKept: data.daysKept,
        target,
      },
      'Cleanup completed'
    );
  } catch (error) {
    logger.error({ err: error }, 'Error running cleanup');
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, 'cleanup', { failedAction: 'run cleanup' })
      ),
    });
  }
}
