/**
 * History Stats Handler
 * Handles /history stats command - view conversation statistics
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { escapeMarkdown } from 'discord.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { historyStatsOptions } from '@tzurot/common-types/generated/commandOptions';
import { formatDateTimeCompact } from '@tzurot/common-types/utils/dateFormatting';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../utils/apiCheck.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { createInfoEmbed } from '../../utils/commandHelpers.js';

const logger = createLogger('history-stats');

/** Format a date string or return 'N/A' for null */
function formatDate(dateStr: string | null): string {
  return dateStr !== null ? formatDateTimeCompact(dateStr) : 'N/A';
}

/**
 * Handle /history stats
 */
export async function handleStats(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const channelId = context.channelId;
  const options = historyStatsOptions(context.interaction);
  const personalitySlug = options.character();
  const personaId = options.persona(); // Optional profile/persona

  if (
    isAutocompleteErrorSentinel(personalitySlug) ||
    (personaId !== null && isAutocompleteErrorSentinel(personaId))
  ) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }

  try {
    const { userClient } = clientsFor(context.interaction);
    const query: { personalitySlug: string; channelId: string; personaId?: string } = {
      personalitySlug,
      channelId,
    };
    if (personaId !== null && personaId.length > 0) {
      query.personaId = personaId;
    }
    const result = await userClient.getHistoryStats(query);

    if (!result.ok) {
      logger.warn({ userId, personalitySlug, status: result.status }, 'Stats failed');
      await context.editReply({
        content:
          result.status === 404
            ? renderSpec(
                CATALOG.error.notFound('Character', { name: escapeMarkdown(personalitySlug) })
              )
            : renderSpec(classifyGatewayFailure(result, 'history stats', { operation: 'read' })),
      });
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

    await context.editReply({ embeds: [embed] });

    logger.info(
      {
        userId,
        personalitySlug,
        channelId,
        visible: data.visible.totalMessages,
        hidden: data.hidden.count,
      },
      'Stats retrieved'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'History Stats' }, 'Error');
    await context.editReply({
      content: renderSpec(classifyGatewayFailure(error, 'history stats', { operation: 'read' })),
    });
  }
}
