/**
 * Me Preset Clear-Default Handler
 * Handles /me preset clear-default subcommand
 * Clears the user's global default preset
 */

import { EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';

const logger = createLogger('settings-preset-clear-default');

/**
 * Handle /me preset clear-default
 */
export async function handleClearDefault(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const result = await callGatewayApi<{ deleted: boolean }>('/user/model-override/default', {
      method: 'DELETE',
      userId,
    });

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, '[Me/Preset] Failed to clear default');
      await context.editReply({ content: `❌ Failed to clear default: ${result.error}` });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Default Preset Cleared')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        'Your default preset has been removed.\n\n' +
          'Personalities will now use their own defaults unless you have a specific override.'
      )
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info({ userId }, '[Me/Preset] Cleared default config');
  } catch (error) {
    logger.error(
      { err: error, userId, command: 'Preset Clear-Default' },
      '[Preset Clear-Default] Error'
    );
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
