/**
 * Channel List Subcommand
 * Handles /channel list
 *
 * Lists all channels with activated personalities.
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags, EmbedBuilder } from 'discord.js';
import { createLogger, type ListChannelActivationsResponse } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';

const logger = createLogger('channel-list');

/**
 * Handle /channel list command
 */
export async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // No permission check needed for list - anyone can see what's activated

  try {
    const result = await callGatewayApi<ListChannelActivationsResponse>('/user/channel/list', {
      userId: interaction.user.id,
      method: 'GET',
    });

    if (!result.ok) {
      logger.warn(
        {
          userId: interaction.user.id,
          error: result.error,
          status: result.status,
        },
        '[Channel] List failed'
      );

      await interaction.editReply(`❌ Failed to list activations: ${result.error}`);
      return;
    }

    const { activations } = result.data;

    if (activations.length === 0) {
      await interaction.editReply(
        '📍 No channels have activated personalities.\n\n' +
          'Use `/channel activate` in a channel to set up auto-responses.'
      );
      return;
    }

    // Build embed with activation list
    const embed = new EmbedBuilder()
      .setTitle('📍 Activated Channels')
      .setColor(0x5865f2) // Discord Blurple
      .setDescription(`${activations.length} channel(s) with activated personalities:`);

    // Add each activation as a field or list item
    const activationLines = activations.map(a => {
      const channelMention = `<#${a.channelId}>`;
      const activatedDate = new Date(a.createdAt).toLocaleDateString();
      return `${channelMention} → **${a.personalityName}** (\`${a.personalitySlug}\`)\n  _Activated: ${activatedDate}_`;
    });

    // Discord embed description limit is 4096 chars
    const description = `${activations.length} channel(s) with activated personalities:\n\n${activationLines.join('\n\n')}`;

    if (description.length <= 4096) {
      embed.setDescription(description);
    } else {
      // If too long, truncate with message
      embed.setDescription(
        `${activations.length} channel(s) with activated personalities:\n\n` +
          `${activationLines.slice(0, 10).join('\n\n')}\n\n` +
          `_...and ${activations.length - 10} more_`
      );
    }

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      {
        userId: interaction.user.id,
        count: activations.length,
      },
      '[Channel] Listed activations'
    );
  } catch (error) {
    logger.error(
      {
        err: error,
        userId: interaction.user.id,
      },
      '[Channel] List error'
    );
    await interaction.editReply('❌ An unexpected error occurred while listing activations.');
  }
}
