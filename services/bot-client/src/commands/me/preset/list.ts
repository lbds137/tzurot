/**
 * Me Preset List Handler
 * Handles /me preset list subcommand
 */

import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS, type ModelOverrideSummary } from '@tzurot/common-types';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';
import { replyWithError, handleCommandError } from '../../../utils/commandHelpers.js';

const logger = createLogger('me-preset-list');

interface ListResponse {
  overrides: ModelOverrideSummary[];
}

/**
 * Handle /me preset list
 */
export async function handleListOverrides(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;

  try {
    const result = await callGatewayApi<ListResponse>('/user/model-override', { userId });

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, '[Me/Preset] Failed to list overrides');
      await replyWithError(interaction, 'Failed to get overrides. Please try again later.');
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

    await interaction.editReply({ embeds: [embed] });

    logger.info({ userId, count: data.overrides.length }, '[Me/Preset] Listed overrides');
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'Preset List' });
  }
}
