/**
 * Wallet Remove Subcommand
 * Removes an API key for a provider
 *
 * Security:
 * - Response is ephemeral (only visible to the user)
 * - Confirms removal before deletion
 */

import { EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS, AIProvider } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';
import { getProviderDisplayName } from '../../../utils/providers.js';

const logger = createLogger('settings-apikey-remove');

/**
 * Handle /wallet remove <provider> subcommand
 * Removes the API key for the specified provider
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral' for this subcommand.
 */
export async function handleRemoveKey(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const provider = context.interaction.options.getString('provider', true) as AIProvider;

  try {
    const result = await callGatewayApi<void>(`/wallet/${provider}`, {
      method: 'DELETE',
      userId,
    });

    if (!result.ok) {
      if (result.status === 404) {
        await context.editReply({
          content: `❌ You don't have an API key configured for **${getProviderDisplayName(provider)}**.`,
        });
        return;
      }

      await context.editReply({ content: `❌ Failed to remove API key: ${result.error}` });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.WARNING)
      .setTitle('🗑️ API Key Removed')
      .setDescription(
        `Your **${getProviderDisplayName(provider)}** API key has been deleted.\n\n` +
          'The bot will now use the default system key (if available) for this provider.'
      )
      .setFooter({ text: 'Use /settings apikey set to configure a new key' })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info({ provider, userId }, '[Wallet Remove] API key removed');
  } catch (error) {
    logger.error({ error, userId, provider }, '[Wallet Remove] Unexpected error');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}
