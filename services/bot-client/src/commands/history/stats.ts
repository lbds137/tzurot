/**
 * History Stats Handler
 * Handles /history stats command - view conversation statistics
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { escapeMarkdown } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { replyWithError, handleCommandError, createInfoEmbed } from '../../utils/commandHelpers.js';

const logger = createLogger('history-stats');

interface StatsResponse {
  channelId: string;
  personalitySlug: string;
  personaId: string;
  personaName: string;
  visible: {
    totalMessages: number;
    userMessages: number;
    assistantMessages: number;
    oldestMessage: string | null;
    newestMessage: string | null;
  };
  hidden: {
    count: number;
  };
  total: {
    totalMessages: number;
    oldestMessage: string | null;
  };
  contextEpoch: string | null;
  canUndo: boolean;
}

/**
 * Format a date string for display
 */
function formatDate(dateStr: string | null): string {
  if (dateStr === null) {
    return 'N/A';
  }
  const date = new Date(dateStr);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Handle /history stats
 */
export async function handleStats(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const channelId = interaction.channelId;
  const personalitySlug = interaction.options.getString('personality', true);
  const personaId = interaction.options.getString('profile', false); // Optional profile/persona

  try {
    // Build query params
    const params = new URLSearchParams({
      personalitySlug,
      channelId,
    });

    // Add optional personaId if explicitly provided
    if (personaId !== null && personaId.length > 0) {
      params.set('personaId', personaId);
    }

    const result = await callGatewayApi<StatsResponse>(`/user/history/stats?${params.toString()}`, {
      userId,
      method: 'GET',
    });

    if (!result.ok) {
      const errorMessage =
        result.status === 404
          ? `Personality "${personalitySlug}" not found.`
          : 'Failed to get stats. Please try again later.';
      logger.warn({ userId, personalitySlug, status: result.status }, '[History] Stats failed');
      await replyWithError(interaction, errorMessage);
      return;
    }

    const data = result.data;

    // Build description with persona info
    let description = `Conversation statistics for **${escapeMarkdown(personalitySlug)}** in this channel.\nProfile: **${escapeMarkdown(data.personaName)}**`;

    if (data.contextEpoch !== null) {
      description += '\n\n*Some messages are hidden due to a context clear.*';
    }

    const embed = createInfoEmbed('Conversation Statistics', description).addFields(
      {
        name: 'Visible Messages',
        value: `${data.visible.totalMessages} messages\n(${data.visible.userMessages} from you, ${data.visible.assistantMessages} from AI)`,
        inline: true,
      },
      {
        name: 'Hidden Messages',
        value: data.hidden.count > 0 ? `${data.hidden.count} messages` : 'None',
        inline: true,
      },
      {
        name: 'Total Stored',
        value: `${data.total.totalMessages} messages`,
        inline: true,
      }
    );

    // Add date range if there are visible messages
    if (data.visible.totalMessages > 0) {
      embed.addFields({
        name: 'Date Range (Visible)',
        value: `${formatDate(data.visible.oldestMessage)} - ${formatDate(data.visible.newestMessage)}`,
        inline: false,
      });
    }

    // Add context epoch info if set
    if (data.contextEpoch !== null) {
      embed.addFields({
        name: 'Context Cleared At',
        value: formatDate(data.contextEpoch) + (data.canUndo ? ' (can undo)' : ''),
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      {
        userId,
        personalitySlug,
        channelId,
        visible: data.visible.totalMessages,
        hidden: data.hidden.count,
      },
      '[History] Stats retrieved'
    );
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'History Stats' });
  }
}
