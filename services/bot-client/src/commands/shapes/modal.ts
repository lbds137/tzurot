/**
 * Shapes Modal Submit Handler
 *
 * Processes session cookie submissions from the shapes auth modal.
 * Sends the cookie to api-gateway for encryption and storage.
 *
 * Security:
 * - All responses are ephemeral
 * - Cookie is immediately sent to gateway for encryption
 * - Never logged or displayed
 */

import type { ModalSubmitInteraction } from 'discord.js';
import { MessageFlags, EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS, parseShapesSessionCookieInput } from '@tzurot/common-types';
import { callGatewayApi, GATEWAY_TIMEOUTS, toGatewayUser } from '../../utils/userGatewayClient.js';
import { ShapesCustomIds } from '../../utils/customIds.js';

const logger = createLogger('shapes-modal');

/**
 * Handle shapes modal submissions
 * Routes based on customId pattern: shapes::auth
 */
export async function handleShapesModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const parsed = ShapesCustomIds.parse(interaction.customId);
  if (parsed === null) {
    await interaction.reply({
      content: '❌ Unknown shapes modal submission',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (parsed.action === 'auth') {
    await handleAuthSubmit(interaction);
  } else {
    await interaction.reply({
      content: '❌ Unknown shapes action',
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Process session cookie submission
 */
async function handleAuthSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const rawInput = interaction.fields.getTextInputValue('cookieValue');
  const parsed = parseShapesSessionCookieInput(rawInput);

  if (!parsed.ok) {
    await interaction.editReply(getInputValidationMessage(parsed.reason));
    return;
  }

  const sessionCookie = parsed.cookie;

  try {
    const result = await callGatewayApi<{ success: boolean }>('/user/shapes/auth', {
      method: 'POST',
      user: toGatewayUser(interaction.user),
      body: { sessionCookie },
      timeout: GATEWAY_TIMEOUTS.DEFERRED,
    });

    if (!result.ok) {
      logger.error(
        { status: result.status, userId: interaction.user.id, error: result.error },
        'Failed to store session cookie'
      );
      await interaction.editReply(getAuthErrorMessage(result.status));
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.SUCCESS)
      .setTitle('✅ Shapes.inc Authenticated')
      .setDescription(
        'Your shapes.inc session cookie has been encrypted and saved.\n\n' +
          'You can now use `/shapes browse` to see your shapes and `/shapes import` to import them.'
      )
      .addFields({
        name: '🔐 Security',
        value:
          'Your cookie is encrypted with AES-256-GCM and stored securely.\n' +
          'Use `/shapes logout` to remove it at any time.',
        inline: false,
      })
      .setFooter({
        text: 'Session cookies expire — re-authenticate if imports fail with auth errors.',
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info({ userId: interaction.user.id }, 'Session cookie stored successfully');
  } catch (error) {
    logger.error({ err: error, userId: interaction.user.id }, 'Error storing cookie');
    await interaction.editReply(
      '❌ An unexpected error occurred while saving your credentials.\n' + 'Please try again later.'
    );
  }
}

function getAuthErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return (
        '❌ **Invalid Cookie**\n\n' +
        'The session cookie format is invalid. Please re-run `/shapes auth` and paste the value ' +
        'of `__Secure-better-auth.session_token` from your browser DevTools.'
      );
    case 500:
    case 502:
    case 503:
      return '❌ **Server Error**\n\nThe server encountered an error. Please try again in a few minutes.';
    default:
      return '❌ **Unable to Save Credentials**\n\nAn unexpected error occurred. Please try again later.';
  }
}

/**
 * Map a parser rejection reason to a user-facing message.
 * Each reason gets a distinct hint so users can self-diagnose the paste mistake.
 */
function getInputValidationMessage(reason: 'empty' | 'wrong-cookie' | 'malformed-value'): string {
  switch (reason) {
    case 'empty':
      return '❌ Cookie value is required.';
    case 'wrong-cookie':
      return (
        "❌ **That doesn't look like the right cookie.**\n\n" +
        'The input contained cookies, but not `__Secure-better-auth.session_token`. ' +
        'Common mistake: copying the whole `Cookie:` header from the Network tab instead ' +
        'of a single cookie value from the Application tab. ' +
        'Please re-run `/shapes auth` and follow steps 4–7.'
      );
    case 'malformed-value':
      return (
        '❌ **Cookie value looks malformed.**\n\n' +
        'Better Auth tokens are opaque alphanumeric strings (typically 32+ characters). ' +
        'Please re-run `/shapes auth` and copy the exact value of ' +
        '`__Secure-better-auth.session_token` from DevTools.'
      );
  }
}
