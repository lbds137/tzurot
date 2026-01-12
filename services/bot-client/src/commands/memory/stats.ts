/**
 * Memory Stats Handler
 * Handles /memory stats command - view memory statistics
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { escapeMarkdown } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { replyWithError, handleCommandError, createInfoEmbed } from '../../utils/commandHelpers.js';
import { resolvePersonalityId } from './autocomplete.js';
import { formatDateTime } from './formatters.js';

const logger = createLogger('memory-stats');

interface StatsResponse {
  personalityId: string;
  personalityName: string;
  personaId: string | null;
  totalCount: number;
  lockedCount: number;
  oldestMemory: string | null;
  newestMemory: string | null;
  focusModeEnabled: boolean;
}

/** Format date or return 'N/A' for null */
function formatDateOrNA(dateStr: string | null): string {
  return dateStr !== null ? formatDateTime(dateStr) : 'N/A';
}

/**
 * Handle /memory stats
 */
export async function handleStats(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const personalityInput = interaction.options.getString('personality', true);

  try {
    // Resolve personality slug to ID
    const personalityId = await resolvePersonalityId(userId, personalityInput);

    if (personalityId === null) {
      await replyWithError(
        interaction,
        `Personality "${personalityInput}" not found. Use autocomplete to select a valid personality.`
      );
      return;
    }

    const result = await callGatewayApi<StatsResponse>(
      `/user/memory/stats?personalityId=${personalityId}`,
      {
        userId,
        method: 'GET',
      }
    );

    if (!result.ok) {
      const errorMessage =
        result.status === 404
          ? `Personality "${personalityInput}" not found.`
          : 'Failed to get stats. Please try again later.';
      logger.warn({ userId, personalityInput, status: result.status }, '[Memory] Stats failed');
      await replyWithError(interaction, errorMessage);
      return;
    }

    const data = result.data;

    // Build description
    let description = `Memory statistics for **${escapeMarkdown(data.personalityName)}**`;

    if (data.focusModeEnabled) {
      description += '\n\n**Focus Mode Active** - Long-term memories are not being retrieved.';
    }

    if (data.personaId === null) {
      description +=
        '\n\n*No profile configured - you have no memories with this personality yet.*';
    }

    const embed = createInfoEmbed('Memory Statistics', description);

    // Add stats fields
    embed.addFields(
      {
        name: 'Total Memories',
        value: data.totalCount.toString(),
        inline: true,
      },
      {
        name: 'Locked (Protected)',
        value: data.lockedCount.toString(),
        inline: true,
      },
      {
        name: 'Focus Mode',
        value: data.focusModeEnabled ? 'Enabled' : 'Disabled',
        inline: true,
      }
    );

    // Add date range if there are memories
    if (data.totalCount > 0) {
      embed.addFields({
        name: 'Date Range',
        value: `${formatDateOrNA(data.oldestMemory)} - ${formatDateOrNA(data.newestMemory)}`,
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      {
        userId,
        personalityId,
        totalCount: data.totalCount,
        lockedCount: data.lockedCount,
        focusModeEnabled: data.focusModeEnabled,
      },
      '[Memory] Stats retrieved'
    );
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'Memory Stats' });
  }
}
