/**
 * Me Preset List Handler
 * Handles /me preset list subcommand
 */

import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { createLogger, DISCORD_COLORS, type ModelOverrideSummary } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';

const logger = createLogger('me-preset-list');

interface ListResponse {
  overrides: ModelOverrideSummary[];
}

/**
 * Handle /me preset list
 */
export async function handleListOverrides(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const result = await callGatewayApi<ListResponse>('/user/model-override', { userId });

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, '[Me/Preset] Failed to list overrides');
      await context.editReply({ content: '❌ Failed to get overrides. Please try again later.' });
      return;
    }

    const data = result.data;

    const embed = new EmbedBuilder()
      .setTitle('🎭 Your Preset Overrides')
      .setColor(DISCORD_COLORS.BLURPLE)
      .setTimestamp();

    if (data.overrides.length === 0) {
      embed.setDescription(
        "You haven't set any preset overrides.\n\nUse `/me preset set` to override which preset a personality uses."
      );
    } else {
      const lines = data.overrides.map(
        o =>
          `**${escapeMarkdown(o.personalityName)}** → ${escapeMarkdown(o.configName ?? 'Unknown')}`
      );

      embed.setDescription(lines.join('\n'));
      embed.setFooter({
        text: `${data.overrides.length} override(s) • Use /me preset reset to remove`,
      });
    }

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, count: data.overrides.length }, '[Me/Preset] Listed overrides');
  } catch (error) {
    logger.error({ err: error, userId, command: 'Preset List' }, '[Preset List] Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
