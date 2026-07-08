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

import { type ModalSubmitInteraction, MessageFlags, EmbedBuilder } from 'discord.js';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { API_KEY_FORMATS } from '@tzurot/common-types/constants/wallet';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getProviderDisplayName } from '../../../utils/providers.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { ApikeyCustomIds } from '../../../utils/customIds.js';
import { replyError } from '../../../utils/dashboard/replyError.js';
import { CATALOG } from '../../../ux/catalog/catalog.js';
import type { MessageSpec } from '../../../ux/catalog/types.js';
import { renderSpec } from '../../../ux/render/render.js';

/** Render a rich validation body through the catalog (❌ glyph from the renderer). */
function validationReply(body: string): string {
  return renderSpec(CATALOG.error.validation(body));
}

const logger = createLogger('settings-apikey-modal');

/**
 * Handle apikey modal submissions
 * Routes based on customId pattern: settings::apikey::set::{provider}
 */
export async function handleApikeyModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  // Parse customId using centralized utilities
  const parsed = ApikeyCustomIds.parse(interaction.customId);
  if (parsed?.provider === undefined) {
    await replyError(interaction, validationReply('Unknown apikey modal submission.'));
    return;
  }

  const provider = parsed.provider as AIProvider;

  if (parsed.action === 'set') {
    await handleSetKeySubmit(interaction, provider);
  } else {
    await replyError(interaction, validationReply('Unknown apikey action.'));
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

  const apiKey = interaction.fields.getTextInputValue('apiKey').trim();

  // Basic validation
  if (apiKey.length === 0) {
    await replyError(interaction, validationReply('API key cannot be empty.'));
    return;
  }

  // Validate key format based on provider
  const formatError = validateKeyFormat(apiKey, provider);
  if (formatError !== null) {
    await replyError(interaction, validationReply(formatError));
    return;
  }

  try {
    // Send to api-gateway for validation and storage
    const { userClient } = clientsFor(interaction);
    const result = await userClient.setWalletKey({ provider, apiKey });

    if (!result.ok) {
      logger.error(
        { status: result.status, provider, userId: interaction.user.id, error: result.error },
        'Failed to store API key'
      );

      // Handle specific error cases with user-friendly messages
      const friendlyMessage = getErrorMessage(result.status, { error: result.error }, provider);
      await replyError(interaction, friendlyMessage);
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
            // z.ai keys don't take over routing by themselves — they apply only
            // when a z.ai model serves the response (auto-promotion). Blanket
            // "will now be used" copy misled a user into thinking every
            // response switched providers.
            (provider === AIProvider.ZaiCoding
              ? 'Your key will be used whenever a z.ai model serves the response.\n'
              : 'Your API key will now be used for AI responses.\n') +
            'Use `/settings apikey test` to verify it works.',
          inline: false,
        }
      )
      .setFooter({ text: 'Use /settings apikey browse to see all configured providers' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info({ provider, userId: interaction.user.id }, 'API key stored successfully');
  } catch (error) {
    logger.error(
      { err: error, provider, userId: interaction.user.id },
      'Unexpected error storing API key'
    );

    await replyError(
      interaction,
      validationReply(
        'An unexpected error occurred while saving your API key.\n' +
          'Please try again later or contact support if the issue persists.'
      )
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
      // Validation error (includes scoped-key permission errors)
      return validationReply(
        '**Validation Error**\n\n' +
          (errorData.message ?? errorData.error ?? 'The request was invalid.') +
          '\n\nPlease check your API key and try again.'
      );

    case 401:
    case 403:
      // Invalid/unauthorized key
      return validationReply(
        '**Invalid API Key**\n\n' +
          'The API key you provided is not valid. Please check:\n' +
          '• The key is copied correctly (no extra spaces)\n' +
          '• The key has not expired or been revoked\n' +
          `• You're using a key for ${providerName}`
      );

    case 402:
      // Insufficient credits
      return validationReply(
        '**Insufficient Credits**\n\n' +
          'Your API key is valid but has insufficient credits.\n' +
          'Please add funds to your account and try again.'
      );

    case 429:
      // Rate limited
      // Rate limited — transient (⚠️), not a definitive ❌ rejection.
      return renderSpec({
        severity: 'warning',
        outcome: 'failed',
        text:
          '**Too Many Requests**\n\n' +
          'You have made too many API key operations recently.\n' +
          'Please wait a few minutes and try again.',
      } satisfies MessageSpec);

    case 500:
    case 502:
    case 503:
    case 504:
      // Server errors
      return validationReply(
        '**Server Error**\n\n' +
          'The server encountered an error while processing your request.\n' +
          'This is usually temporary. Please try again in a few minutes.\n\n' +
          'If the problem persists, contact support.'
      );

    case 0:
      // Transport-level failure (client timeout or dropped connection). A slow
      // provider validation can outlast the client timeout while the gateway
      // still completes the save, so point the user at browse to confirm rather
      // than blindly retrying and creating churn.
      // Outcome-uncertain (⏳): the save may have applied — steer to verify,
      // never invite a blind retry (the write-uncertain shape's whole point).
      return renderSpec({
        severity: 'progress',
        outcome: 'uncertain',
        text:
          '**Request Timed Out**\n\n' +
          "The request didn't complete in time. Your key may already have been saved —\n" +
          'check `/settings apikey browse` before trying again.',
      } satisfies MessageSpec);

    default:
      // Unknown error - still provide friendly message
      return validationReply(
        '**Unable to Save API Key**\n\n' +
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
          '**Invalid OpenRouter Key Format**\n\n' +
          `OpenRouter API keys should start with \`${API_KEY_FORMATS.OPENROUTER_PREFIX}\`.\n` +
          'Get your key at: https://openrouter.ai/keys'
        );
      }
      return null;

    case AIProvider.ElevenLabs:
      // ElevenLabs keys have no strict prefix — accept any non-empty key
      // Validation happens server-side via the ElevenLabs /v1/user endpoint
      return null;

    case AIProvider.ZaiCoding:
      // z.ai keys have no documented strict prefix — accept any non-empty key
      // Validation happens server-side via a minimal chat-completions probe
      return null;

    case AIProvider.Mistral:
      // Mistral keys have no documented strict prefix (32-char base64-ish) —
      // accept any non-empty key; validation happens server-side at first use.
      return null;

    default: {
      // Type guard for exhaustive check - add new providers above
      const _exhaustive: never = provider;
      void _exhaustive;
      return null;
    }
  }
}
