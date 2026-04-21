/**
 * Admin Cleanup Subcommand
 * Handles /admin cleanup - Manually trigger cleanup of old conversation history and tombstones
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { createLogger, CLEANUP_DEFAULTS, adminCleanupOptions } from '@tzurot/common-types';
import { adminPostJson } from '../../utils/adminApiClient.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const logger = createLogger('admin-cleanup');

interface CleanupResponse {
  success: boolean;
  historyDeleted: number;
  tombstonesDeleted: number;
  daysKept: number;
  message: string;
  timestamp: string;
}

export async function handleCleanup(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = adminCleanupOptions(context.interaction);
  const daysToKeep = options.days() ?? CLEANUP_DEFAULTS.DAYS_TO_KEEP_HISTORY;
  const target = options.target() ?? 'all';

  try {
    const response = await adminPostJson('/admin/cleanup', {
      daysToKeep,
      target,
      ownerId: userId,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Cleanup failed');
      await context.editReply({
        content: `❌ Cleanup failed (HTTP ${response.status}):\n\`\`\`\n${errorText}\n\`\`\``,
      });
      return;
    }

    const data = (await response.json()) as CleanupResponse;

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
    await context.editReply({ content: '❌ Error running cleanup. Please try again later.' });
  }
}
