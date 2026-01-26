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
import { createLogger, DISCORD_COLORS, AIProvider, API_KEY_FORMATS } from '@tzurot/common-types';
import { getProviderDisplayName } from '../../../utils/providers.js';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';
import { ApikeyCustomIds } from '../../../utils/customIds.js';

const logger = createLogger('settings-apikey-modal');

/**
 * Handle apikey modal submissions
 * Routes based on customId pattern: settings::apikey::set::{provider}
 */
export async function handleApikeyModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  // Parse customId using centralized utilities
  const parsed = ApikeyCustomIds.parse(interaction.customId);
  if (parsed?.provider === undefined) {
    await interaction.reply({
      content: '❌ Unknown apikey modal submission',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const provider = parsed.provider as AIProvider;

  if (parsed.action === 'set') {
    await handleSetKeySubmit(interaction, provider);
  } else {
    await interaction.reply({
      content: '❌ Unknown apikey action',
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
    const result = await callGatewayApi<{ success: boolean }>('/wallet/set', {
      method: 'POST',
      userId: interaction.user.id,
      body: { provider, apiKey },
    });

    if (!result.ok) {
      logger.error(
        { status: result.status, provider, userId: interaction.user.id, error: result.error },
        '[Settings/ApiKey] Failed to store API key'
      );

      // Handle specific error cases with user-friendly messages
      const friendlyMessage = getErrorMessage(result.status, { error: result.error }, provider);
      await interaction.editReply(friendlyMessage);
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
            'Use `/settings apikey test` to verify it works.',
          inline: false,
        }
      )
      .setFooter({ text: 'Use /settings apikey browse to see all configured providers' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      { provider, userId: interaction.user.id },
      '[Settings/ApiKey] API key stored successfully'
    );
  } catch (error) {
    logger.error({ err: error, provider, userId: interaction.user.id }, '[Settings/ApiKey] Error');

    await interaction.editReply(
      '❌ An unexpected error occurred while saving your API key.\n' +
        'Please try again later or contact support if the issue persists.'
    );
  }
}

/**
 * Get user-friendly error message for HTTP status codes
 */
function getErrorMessage(
  status: number,
  errorData: { error?: string; message?: string },
  provider: AIProvider
): string {
  const providerName = getProviderDisplayName(provider);

  switch (status) {
    case 400:
      // Validation error
      return (
        '❌ **Validation Error**\n\n' +
        (errorData.message ?? 'The request was invalid.') +
        '\n\nPlease check your API key and try again.'
      );

    case 401:
    case 403:
      // Invalid/unauthorized key
      return (
        '❌ **Invalid API Key**\n\n' +
        'The API key you provided is not valid. Please check:\n' +
        '• The key is copied correctly (no extra spaces)\n' +
        '• The key has not expired or been revoked\n' +
        `• You're using a key for ${providerName}`
      );

    case 402:
      // Insufficient credits
      return (
        '❌ **Insufficient Credits**\n\n' +
        'Your API key is valid but has insufficient credits.\n' +
        'Please add funds to your account and try again.'
      );

    case 429:
      // Rate limited
      return (
        '⏳ **Too Many Requests**\n\n' +
        'You have made too many API key operations recently.\n' +
        'Please wait a few minutes and try again.'
      );

    case 500:
    case 502:
    case 503:
    case 504:
      // Server errors
      return (
        '❌ **Server Error**\n\n' +
        'The server encountered an error while processing your request.\n' +
        'This is usually temporary. Please try again in a few minutes.\n\n' +
        'If the problem persists, contact support.'
      );

    default:
      // Unknown error - still provide friendly message
      return (
        '❌ **Unable to Save API Key**\n\n' +
        'An unexpected error occurred while saving your API key.\n' +
        (errorData.message !== undefined && errorData.message.length > 0
          ? `Details: ${errorData.message}\n\n`
          : '') +
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
      if (!apiKey.startsWith(API_KEY_FORMATS.OPENROUTER_PREFIX)) {
        return (
          '❌ **Invalid OpenRouter Key Format**\n\n' +
          `OpenRouter API keys should start with \`${API_KEY_FORMATS.OPENROUTER_PREFIX}\`.\n` +
          'Get your key at: https://openrouter.ai/keys'
        );
      }
      return null;

    default: {
      // Type guard for exhaustive check - add new providers above
      const _exhaustive: never = provider;
      void _exhaustive;
      return null;
    }
  }
}
