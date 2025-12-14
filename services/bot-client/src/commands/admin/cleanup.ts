/**
 * Admin Cleanup Subcommand
 * Handles /admin cleanup - Manually trigger cleanup of old conversation history and tombstones
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
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
  const daysToKeep = interaction.options.getInteger('days') ?? 30;
  const target = interaction.options.getString('target') ?? 'all';

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const response = await adminPostJson('/admin/cleanup', {
      daysToKeep,
      target,
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
