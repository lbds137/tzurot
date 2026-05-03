/**
 * Settings TTS Clear-Default Handler
 * Handles /settings tts clear-default subcommand
 * Clears the user's global default TTS config
 *
 * Mirrors `/settings preset clear-default` UX shape exactly. The
 * "show new effective default" UX upgrade is filed as a cross-cutting
 * backlog item (apply to preset + tts together later).
 */

import { EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi, toGatewayUser } from '../../../utils/userGatewayClient.js';

const logger = createLogger('settings-tts-clear-default');

/** Handle /settings tts clear-default */
export async function handleTtsClearDefault(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const result = await callGatewayApi<{ deleted: boolean }>('/user/tts-override/default', {
      method: 'DELETE',
      user: toGatewayUser(context.user),
    });

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, 'Failed to clear default TTS');
      await context.editReply({ content: `❌ Failed to clear default: ${result.error}` });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Default TTS Config Cleared')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        'Your default TTS config has been removed.\n\n' +
          'Personalities will now use their own defaults unless you have a specific override.'
      )
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info({ userId }, 'Cleared default TTS config');
  } catch (error) {
    logger.error({ err: error, userId, command: 'TTS Clear-Default' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
