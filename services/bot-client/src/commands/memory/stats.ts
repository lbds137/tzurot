/**
 * Memory Stats Handler
 * Handles /memory stats command - view memory statistics
 */

import { escapeMarkdown } from 'discord.js';
import { memoryStatsOptions } from '@tzurot/common-types/generated/commandOptions';
import { UX_SENTINELS } from '@tzurot/common-types/constants/uxVocabulary';
import { formatDiscordTimestamp } from '@tzurot/common-types/utils/dateFormatting';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { createInfoEmbed } from '../../utils/commandHelpers.js';
import { resolveRequiredPersonality } from './resolveHelpers.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';

const logger = createLogger('memory-stats');

/** Format date as a dynamic timestamp, or the empty-value sentinel for null */
function formatDateOrSentinel(dateStr: string | null): string {
  return dateStr !== null ? formatDiscordTimestamp(dateStr, 'D') : UX_SENTINELS.NOT_SET;
}

/**
 * Handle /memory stats
 */
export async function handleStats(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const { userClient } = clientsFor(context.interaction);
  const options = memoryStatsOptions(context.interaction);
  const personalityInput = options.character();

  try {
    // Resolve personality slug to ID
    const personalityId = await resolveRequiredPersonality(context, userClient, personalityInput);
    if (personalityId === null) {
      return;
    }

    const result = await userClient.getStats({ personalityId });

    if (!result.ok) {
      logger.warn({ userId, personalityInput, status: result.status }, 'Stats failed');
      await context.editReply({
        content:
          result.status === 404
            ? renderSpec(
                CATALOG.error.notFound('Character', { name: escapeMarkdown(personalityInput) })
              )
            : renderSpec(classifyGatewayFailure(result, 'memory stats', { operation: 'read' })),
      });
      return;
    }

    const data = result.data;

    // Build description
    let description = `Memory statistics for **${escapeMarkdown(data.personalityName)}**`;

    if (data.focusModeEnabled) {
      description += '\n\n**Focus Mode Active** - Long-term memories are not being retrieved.';
    }

    if (data.personaId === null) {
      description += '\n\n*No profile configured - you have no memories with this character yet.*';
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
        value: `${formatDateOrSentinel(data.oldestMemory)} - ${formatDateOrSentinel(data.newestMemory)}`,
        inline: false,
      });
    }

    await context.editReply({ embeds: [embed] });

    logger.info(
      {
        userId,
        personalityId,
        totalCount: data.totalCount,
        lockedCount: data.lockedCount,
        focusModeEnabled: data.focusModeEnabled,
      },
      'Stats retrieved'
    );
  } catch (error) {
    logger.error({ err: error, userId }, 'Unexpected error');
    await context.editReply({
      content: renderSpec(classifyGatewayFailure(error, 'memory stats', { operation: 'read' })),
    });
  }
}
