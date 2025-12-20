/**
 * Admin Cleanup Subcommand
 * Handles /admin cleanup - Manually trigger cleanup of old conversation history and tombstones
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, CLEANUP_DEFAULTS } from '@tzurot/common-types';
import { adminPostJson } from '../../utils/adminApiClient.js';

const logger = createLogger('admin-cleanup');

interface CleanupResponse {
  success: boolean;
  historyDeleted: number;
  tombstonesDeleted: number;
  daysKept: number;
  message: string;
  timestamp: string;
}

export async function handleCleanup(interaction: ChatInputCommandInteraction): Promise<void> {
  // Note: deferReply is handled by top-level interactionCreate handler
  const daysToKeep =
    interaction.options.getInteger('days') ?? CLEANUP_DEFAULTS.DAYS_TO_KEEP_HISTORY;
  const target = interaction.options.getString('target') ?? 'all';

  try {
    const response = await adminPostJson('/admin/cleanup', {
      daysToKeep,
      target,
      ownerId: interaction.user.id,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, '[AdminCleanup] Cleanup failed');
      await interaction.editReply(
        `❌ Cleanup failed (HTTP ${response.status}):\n\`\`\`\n${errorText}\n\`\`\``
      );
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

    await interaction.editReply(lines.join('\n'));

    logger.info(
      {
        historyDeleted: data.historyDeleted,
        tombstonesDeleted: data.tombstonesDeleted,
        daysKept: data.daysKept,
        target,
      },
      '[AdminCleanup] Cleanup completed'
    );
  } catch (error) {
    logger.error({ err: error }, '[AdminCleanup] Error running cleanup');
    await interaction.editReply('❌ Error running cleanup. Please try again later.');
  }
}
