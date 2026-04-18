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
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
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

  const cookiePart0 = interaction.fields.getTextInputValue('cookiePart0').trim();
  const cookiePart1 = interaction.fields.getTextInputValue('cookiePart1').trim();

  if (cookiePart0.length === 0) {
    await interaction.editReply('❌ Cookie value is required.');
    return;
  }

  // Build cookie string based on whether user has one or two cookies
  const sessionCookie =
    cookiePart1.length > 0
      ? `appSession.0=${cookiePart0}; appSession.1=${cookiePart1}`
      : `appSession=${cookiePart0}`;

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
        '[Shapes] Failed to store session cookie'
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

    logger.info({ userId: interaction.user.id }, '[Shapes] Session cookie stored successfully');
  } catch (error) {
    logger.error({ err: error, userId: interaction.user.id }, '[Shapes] Error storing cookie');
    await interaction.editReply(
      '❌ An unexpected error occurred while saving your credentials.\n' + 'Please try again later.'
    );
  }
}

function getAuthErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return '❌ **Invalid Cookie**\n\nThe session cookie format is invalid. Please check that you copied both parts correctly.';
    case 500:
    case 502:
    case 503:
      return '❌ **Server Error**\n\nThe server encountered an error. Please try again in a few minutes.';
    default:
      return '❌ **Unable to Save Credentials**\n\nAn unexpected error occurred. Please try again later.';
  }
}
