/**
 * Wallet Remove Subcommand
 * Removes an API key for a provider
 *
 * Security:
 * - Response is ephemeral (only visible to the user)
 * - Confirms removal before deletion
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS, AIProvider } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { replyWithError, handleCommandError } from '../../utils/commandHelpers.js';
import { getProviderDisplayName } from '../../utils/providers.js';

const logger = createLogger('wallet-remove');

/**
 * Handle /wallet remove <provider> subcommand
 * Removes the API key for the specified provider
 */
export async function handleRemoveKey(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const provider = interaction.options.getString('provider', true) as AIProvider;

  try {
    const result = await callGatewayApi<void>(`/wallet/${provider}`, {
      method: 'DELETE',
      userId,
    });

    if (!result.ok) {
      if (result.status === 404) {
        await replyWithError(
          interaction,
          `You don't have an API key configured for **${getProviderDisplayName(provider)}**.`
        );
        return;
      }

      await replyWithError(interaction, `Failed to remove API key: ${result.error}`);
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.WARNING)
      .setTitle('🗑️ API Key Removed')
      .setDescription(
        `Your **${getProviderDisplayName(provider)}** API key has been deleted.\n\n` +
          'The bot will now use the default system key (if available) for this provider.'
      )
      .setFooter({ text: 'Use /wallet set to configure a new key' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info({ provider, userId }, '[Wallet Remove] API key removed');
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'Wallet Remove' });
  }
}
