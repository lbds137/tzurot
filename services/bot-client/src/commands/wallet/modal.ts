/**
 * Wallet Modal Submit Handler
 * Processes API key submissions from the wallet set modal
 *
 * Security:
 * - All responses are ephemeral (only visible to the user)
 * - API key is immediately sent to api-gateway for encryption
 * - Key is validated before storage
 * - Never logs or displays the actual API key
 */

import type { ModalSubmitInteraction } from 'discord.js';
import { MessageFlags, EmbedBuilder } from 'discord.js';
import {
  getConfig,
  createLogger,
  CONTENT_TYPES,
  DISCORD_COLORS,
  AIProvider,
} from '@tzurot/common-types';
import { getProviderDisplayName } from '../../utils/providers.js';

const logger = createLogger('wallet-modal');

/**
 * Handle wallet modal submissions
 * Routes based on customId pattern: wallet-set-{provider}
 */
export async function handleWalletModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  // Parse customId to extract action and provider
  // Format: wallet-set-{provider}
  const parts = interaction.customId.split('-');
  if (parts.length < 3 || parts[0] !== 'wallet') {
    await interaction.reply({
      content: '❌ Unknown wallet modal submission',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const action = parts[1];
  const provider = parts.slice(2).join('-') as AIProvider;

  if (action === 'set') {
    await handleSetKeySubmit(interaction, provider);
  } else {
    await interaction.reply({
      content: '❌ Unknown wallet action',
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Process API key submission
 */
async function handleSetKeySubmit(
  interaction: ModalSubmitInteraction,
  provider: AIProvider
): Promise<void> {
  // Defer reply immediately (ephemeral for security)
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const config = getConfig();
  const apiKey = interaction.fields.getTextInputValue('apiKey');

  // Basic validation
  if (apiKey.trim().length === 0) {
    await interaction.editReply('❌ API key cannot be empty');
    return;
  }

  // Validate key format based on provider
  const formatError = validateKeyFormat(apiKey, provider);
  if (formatError !== null) {
    await interaction.editReply(formatError);
    return;
  }

  try {
    // Send to api-gateway for validation and storage
    const gatewayUrl = config.GATEWAY_URL;
    const response = await fetch(`${gatewayUrl}/wallet/set`, {
      method: 'POST',
      headers: {
        'Content-Type': CONTENT_TYPES.JSON,
        'X-User-Id': interaction.user.id,
      },
      body: JSON.stringify({
        provider,
        apiKey,
      }),
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as { error?: string };
      const errorMessage = errorData.error ?? `HTTP ${response.status}`;

      logger.error(
        { status: response.status, provider, userId: interaction.user.id },
        '[Wallet Modal] Failed to store API key'
      );

      // Handle specific error cases
      if (response.status === 401) {
        await interaction.editReply(
          '❌ **Invalid API Key**\n\n' +
            'The API key you provided is not valid. Please check:\n' +
            '• The key is copied correctly (no extra spaces)\n' +
            '• The key has not expired or been revoked\n' +
            `• You're using a key for ${getProviderDisplayName(provider)}`
        );
        return;
      }

      if (response.status === 402) {
        await interaction.editReply(
          '❌ **Insufficient Credits**\n\n' +
            'Your API key is valid but has insufficient credits.\n' +
            'Please add funds to your account and try again.'
        );
        return;
      }

      await interaction.editReply(`❌ Failed to save API key: ${errorMessage}`);
      return;
    }

    // Success!
    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.SUCCESS)
      .setTitle('✅ API Key Configured')
      .setDescription(`Your **${getProviderDisplayName(provider)}** API key has been saved.`)
      .addFields(
        {
          name: '🔐 Security',
          value: 'Your key is encrypted at rest and never visible in logs.',
          inline: false,
        },
        {
          name: '💡 Next Steps',
          value:
            'Your API key will now be used for AI responses.\n' +
            'Use `/wallet test` to verify it works.',
          inline: false,
        }
      )
      .setFooter({ text: 'Use /wallet list to see all configured providers' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      { provider, userId: interaction.user.id },
      '[Wallet Modal] API key stored successfully'
    );
  } catch (error) {
    logger.error({ err: error, provider, userId: interaction.user.id }, '[Wallet Modal] Error');

    await interaction.editReply(
      '❌ An unexpected error occurred while saving your API key.\n' +
        'Please try again later or contact support if the issue persists.'
    );
  }
}

/**
 * Validate API key format based on provider
 */
function validateKeyFormat(apiKey: string, provider: AIProvider): string | null {
  switch (provider) {
    case AIProvider.OpenRouter:
      // OpenRouter keys start with 'sk-or-' or 'sk-or-v1-'
      if (!apiKey.startsWith('sk-or-')) {
        return (
          '❌ **Invalid OpenRouter Key Format**\n\n' +
          'OpenRouter API keys should start with `sk-or-`.\n' +
          'Get your key at: https://openrouter.ai/keys'
        );
      }
      break;

    case AIProvider.OpenAI:
      // OpenAI keys start with 'sk-'
      if (!apiKey.startsWith('sk-')) {
        return (
          '❌ **Invalid OpenAI Key Format**\n\n' +
          'OpenAI API keys should start with `sk-`.\n' +
          'Get your key at: https://platform.openai.com/api-keys'
        );
      }
      // But shouldn't be OpenRouter keys
      if (apiKey.startsWith('sk-or-')) {
        return (
          '❌ **Wrong Provider**\n\n' +
          'This looks like an OpenRouter key (starts with `sk-or-`).\n' +
          'Use `/wallet set provider:OpenRouter` instead.'
        );
      }
      break;
  }

  return null;
}
