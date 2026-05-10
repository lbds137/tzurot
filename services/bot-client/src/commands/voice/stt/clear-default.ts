/**
 * Voice STT Clear-Default Handler
 * Handles /voice stt clear-default — clears Layer 2 of the STT cascade
 * (User.defaultSttProviderId). Cascade falls through to Layer 3 (TTS-derived)
 * for personalities without per-personality overrides.
 */

import { EmbedBuilder } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  type ClearSttDefaultProviderResponse,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi, toGatewayUser } from '../../../utils/userGatewayClient.js';

const logger = createLogger('voice-stt-clear-default');

/** Handle /voice stt clear-default */
export async function handleSttClearDefault(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const result = await callGatewayApi<ClearSttDefaultProviderResponse>(
      '/user/stt-override/default',
      {
        method: 'DELETE',
        user: toGatewayUser(context.user),
      }
    );

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, 'Failed to clear default STT');
      await context.editReply({ content: `❌ Failed to clear default: ${result.error}` });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Transcription Default Cleared')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        'Your transcription default has been cleared.\n\n' +
          'Voice messages will be transcribed by the same provider you use for speaking, ' +
          'or by the free self-hosted engine if neither applies.'
      )
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info({ userId }, 'Cleared default STT provider');
  } catch (error) {
    logger.error({ err: error, userId, command: 'STT Clear-Default' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
