/**
 * Settings TTS Clear-Default Handler
 * Handles /settings tts clear-default subcommand
 * Clears the user's global default TTS config
 *
 * Mirrors `/settings preset clear-default` UX shape exactly.
 */

import { EmbedBuilder } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  type ClearTtsDefaultConfigResponse,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi, toGatewayUser } from '../../../utils/userGatewayClient.js';

const logger = createLogger('settings-tts-clear-default');

/** Handle /settings tts clear-default */
export async function handleTtsClearDefault(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const result = await callGatewayApi<ClearTtsDefaultConfigResponse>(
      '/user/tts-override/default',
      {
        method: 'DELETE',
        user: toGatewayUser(context.user),
      }
    );

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, 'Failed to clear default TTS');
      await context.editReply({ content: `❌ Failed to clear default: ${result.error}` });
      return;
    }

    // Tell the user explicitly what they'll get next. Per-personality
    // overrides are unaffected and surface in the second sentence.
    const fallbackLine =
      result.data.newEffectiveDefault !== null
        ? `Falling back to system default: \`${result.data.newEffectiveDefault.name}\`.`
        : 'No system default is configured; the bot will use its built-in fallback.';

    const embed = new EmbedBuilder()
      .setTitle('✅ Default TTS Config Cleared')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `Your default TTS config has been removed.\n\n${fallbackLine}\n\n` +
          'Personalities with their own per-personality overrides will continue to use those.'
      )
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, newDefault: result.data.newEffectiveDefault?.name ?? null },
      'Cleared default TTS config'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'TTS Clear-Default' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
