/**
 * Wallet Test Subcommand
 * Tests API key validity by making a dry-run API call
 *
 * Security:
 * - Response is ephemeral (only visible to the user)
 * - Never displays the actual API key
 */

import { EmbedBuilder } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  AIProvider,
  settingsApikeyTestOptions,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi, toGatewayUser } from '../../../utils/userGatewayClient.js';
import { getProviderDisplayName } from '../../../utils/providers.js';

const logger = createLogger('settings-apikey-test');

interface WalletTestResponse {
  valid: boolean;
  provider: AIProvider;
  credits?: number;
  error?: string;
  errorCode?: string;
}

/**
 * Handle /wallet test <provider> subcommand
 * Tests the API key validity
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral' for this subcommand.
 */
export async function handleTestKey(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = settingsApikeyTestOptions(context.interaction);
  const provider = options.provider() as AIProvider;

  try {
    const result = await callGatewayApi<WalletTestResponse>('/wallet/test', {
      method: 'POST',
      user: toGatewayUser(context.user),
      body: { provider },
    });

    if (!result.ok) {
      if (result.status === 404) {
        await context.editReply({
          content: `❌ You don't have an API key configured for **${getProviderDisplayName(provider)}**.\n\nUse \`/settings apikey set\` to add your API key first.`,
        });
        return;
      }

      // Handle validation errors - need to try parsing the error response for details
      const embed = new EmbedBuilder()
        .setColor(DISCORD_COLORS.ERROR)
        .setTitle('❌ API Key Invalid')
        .setDescription(`Your **${getProviderDisplayName(provider)}** API key failed validation.`)
        .addFields({
          name: 'Error',
          value: result.error,
          inline: false,
        })
        .addFields({
          name: '💡 What to do',
          value:
            '• Check if your key is still valid\n' +
            '• Ensure you have credits/quota remaining\n' +
            '• Use `/settings apikey set` to update your key',
          inline: false,
        })
        .setTimestamp();

      await context.editReply({ embeds: [embed] });
      return;
    }

    const data = result.data;

    // Success - key is valid
    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.SUCCESS)
      .setTitle('✅ API Key Valid')
      .setDescription(`Your **${getProviderDisplayName(provider)}** API key is working correctly!`);

    // Add credit balance if available (OpenRouter provides this)
    if (data.credits !== undefined) {
      embed.addFields({
        name: '💰 Credit Balance',
        value: `$${data.credits.toFixed(4)}`,
        inline: true,
      });
    }

    embed
      .addFields({
        name: '🚀 Ready to Use',
        value: 'Your key will be used for AI responses.',
        inline: true,
      })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info({ provider, userId, hasCredits: data.credits !== undefined }, 'API key validated');
  } catch (error) {
    logger.error({ error, userId, provider }, 'Unexpected error');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}
