/**
 * Model List Handler
 * Handles /model list subcommand
 */

import { EmbedBuilder, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, getConfig, DISCORD_COLORS } from '@tzurot/common-types';

const logger = createLogger('model-list');
const config = getConfig();

interface OverrideSummary {
  personalityId: string;
  personalityName: string;
  configId: string | null;
  configName: string | null;
}

/**
 * Handle /model list
 */
export async function handleListOverrides(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const gatewayUrl = config.GATEWAY_URL;
    if (gatewayUrl === undefined || gatewayUrl.length === 0) {
      await interaction.editReply({
        content: '❌ Service configuration error. Please try again later.',
      });
      return;
    }

    const response = await fetch(`${gatewayUrl}/user/model-override`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userId}`,
      },
    });

    if (!response.ok) {
      logger.warn({ userId, status: response.status }, '[Model] Failed to list overrides');
      await interaction.editReply({
        content: '❌ Failed to get overrides. Please try again later.',
      });
      return;
    }

    const data = (await response.json()) as { overrides: OverrideSummary[] };

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
    logger.error({ err: error, userId }, '[Model] Error listing overrides');
    await interaction.editReply({
      content: '❌ An error occurred. Please try again later.',
    });
  }
}
