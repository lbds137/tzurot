/**
 * Channel Activate Subcommand
 * Handles /channel activate <personality>
 *
 * Activates a personality in the current channel so it responds
 * to ALL messages without requiring @mentions.
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { createLogger, type ActivateChannelResponse } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { requireManageMessagesDeferred } from '../../utils/permissions.js';
import { invalidateChannelActivationCache } from '../../utils/GatewayClient.js';

const logger = createLogger('channel-activate');

/**
 * Handle /channel activate command
 */
export async function handleActivate(interaction: ChatInputCommandInteraction): Promise<void> {
  const personalitySlug = interaction.options.getString('personality', true);
  const channelId = interaction.channelId;
  const guildId = interaction.guildId;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Check permission after deferring
  if (!(await requireManageMessagesDeferred(interaction))) {
    return;
  }

  // Guild ID is required (permission check ensures we're in a guild)
  if (guildId === null) {
    await interaction.editReply('❌ This command can only be used in a server.');
    return;
  }

  try {
    const result = await callGatewayApi<ActivateChannelResponse>('/user/channel/activate', {
      userId: interaction.user.id,
      method: 'POST',
      body: {
        channelId,
        personalitySlug,
        guildId,
      },
    });

    if (!result.ok) {
      logger.warn(
        {
          userId: interaction.user.id,
          channelId,
          personalitySlug,
          error: result.error,
          status: result.status,
        },
        '[Channel] Activation failed'
      );

      // Handle specific error cases
      if (result.status === 404) {
        await interaction.editReply(
          `❌ Personality **${personalitySlug}** not found.\n\n` +
            'Use the autocomplete to select a valid personality.'
        );
        return;
      }

      if (result.status === 403) {
        await interaction.editReply(
          `❌ You don't have access to **${personalitySlug}**.\n\n` +
            'You can only activate personalities that are public or that you own.'
        );
        return;
      }

      await interaction.editReply(`❌ Failed to activate: ${result.error}`);
      return;
    }

    const { activation, replaced } = result.data;
    const replacedNote = replaced ? ' (replaced previous activation)' : '';

    // Invalidate cache so the change takes effect immediately
    invalidateChannelActivationCache(channelId);

    await interaction.editReply(
      `✅ Activated **${activation.personalityName}** in this channel${replacedNote}.\n\n` +
        `All messages in <#${channelId}> will now get responses from this personality.`
    );

    logger.info(
      {
        userId: interaction.user.id,
        channelId,
        guildId,
        personalitySlug: activation.personalitySlug,
        activationId: activation.id,
        replaced,
      },
      '[Channel] Personality activated'
    );
  } catch (error) {
    logger.error(
      {
        err: error,
        userId: interaction.user.id,
        channelId,
        personalitySlug,
      },
      '[Channel] Activation error'
    );
    await interaction.editReply('❌ An unexpected error occurred while activating the channel.');
  }
}
