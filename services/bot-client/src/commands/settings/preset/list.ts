/**
 * Settings Preset List Handler
 * Handles /settings preset list subcommand
 */

import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { clientsFor } from '../../../utils/gatewayClients.js';

const logger = createLogger('settings-preset-browse');

/**
 * Handle /settings preset list
 */
export async function handleListOverrides(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.listModelOverrides();

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, 'Failed to list overrides');
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
        "You haven't set any preset overrides.\n\nUse `/settings preset set` to override which preset a character uses."
      );
    } else {
      const lines = data.overrides.map(
        o =>
          `**${escapeMarkdown(o.personalityName)}** → ${escapeMarkdown(o.configName ?? 'Unknown')}`
      );

      embed.setDescription(lines.join('\n'));
      embed.setFooter({
        text: `${data.overrides.length} override(s) • Use /settings preset clear to remove`,
      });
    }

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, count: data.overrides.length }, 'Listed overrides');
  } catch (error) {
    logger.error({ err: error, userId, command: 'Preset List' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
