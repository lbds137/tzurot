/**
 * Shapes Logout Subcommand
 *
 * Removes stored shapes.inc credentials for the user.
 */

import { EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi, GATEWAY_TIMEOUTS } from '../../utils/userGatewayClient.js';

const logger = createLogger('shapes-logout');

/**
 * Handle /shapes logout subcommand
 * Removes the stored shapes.inc session cookie
 */
export async function handleLogout(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const result = await callGatewayApi<void>('/user/shapes/auth', {
      method: 'DELETE',
      userId,
      timeout: GATEWAY_TIMEOUTS.DEFERRED,
    });

    if (!result.ok) {
      if (result.status === 404) {
        await context.editReply({
          content: "❌ You don't have any shapes.inc credentials stored.",
        });
        return;
      }

      await context.editReply({ content: `❌ Failed to remove credentials: ${result.error}` });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.WARNING)
      .setTitle('🗑️ Shapes.inc Credentials Removed')
      .setDescription(
        'Your shapes.inc session cookie has been deleted.\n\n' +
          'Use `/shapes auth` to re-authenticate if you need to import or export shapes.'
      )
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info({ userId }, '[Shapes] Credentials removed');
  } catch (error) {
    logger.error({ err: error, userId }, '[Shapes] Unexpected error removing credentials');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}
