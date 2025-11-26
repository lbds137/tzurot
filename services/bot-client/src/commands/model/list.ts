/**
 * Model List Handler
 * Handles /model list subcommand
 */

import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { deferEphemeral, replyWithError, handleCommandError } from '../../utils/commandHelpers.js';

const logger = createLogger('model-list');

interface OverrideSummary {
  personalityId: string;
  personalityName: string;
  configId: string | null;
  configName: string | null;
}

interface ListResponse {
  overrides: OverrideSummary[];
}

/**
 * Handle /model list
 */
export async function handleListOverrides(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;

  await deferEphemeral(interaction);

  try {
    const result = await callGatewayApi<ListResponse>('/user/model-override', { userId });

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, '[Model] Failed to list overrides');
      await replyWithError(interaction, 'Failed to get overrides. Please try again later.');
      return;
    }

    const data = result.data;

    const embed = new EmbedBuilder()
      .setTitle('🎭 Your Model Overrides')
      .setColor(DISCORD_COLORS.BLURPLE)
      .setTimestamp();

    if (data.overrides.length === 0) {
      embed.setDescription(
        "You haven't set any model overrides.\n\nUse `/model set` to override which model a personality uses."
      );
    } else {
      const lines = data.overrides.map(
        o => `**${o.personalityName}** → ${o.configName ?? 'Unknown'}`
      );

      embed.setDescription(lines.join('\n'));
      embed.setFooter({
        text: `${data.overrides.length} override(s) • Use /model reset to remove`,
      });
    }

    await interaction.editReply({ embeds: [embed] });

    logger.info({ userId, count: data.overrides.length }, '[Model] Listed overrides');
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'Model List' });
  }
}
