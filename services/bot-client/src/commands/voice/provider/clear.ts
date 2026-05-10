/**
 * Voice Provider Clear Handler
 * Handles /voice provider clear — clears User.defaultProvider. STT cascade
 * falls through to voice-engine fallback (Layer 5).
 */

import { EmbedBuilder } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  type ClearVoiceProviderResponse,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi, toGatewayUser } from '../../../utils/userGatewayClient.js';

const logger = createLogger('voice-provider-clear');

/** Handle /voice provider clear */
export async function handleProviderClear(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const result = await callGatewayApi<ClearVoiceProviderResponse>('/user/voice-provider', {
      method: 'DELETE',
      user: toGatewayUser(context.user),
    });

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, 'Failed to clear voice provider');
      await context.editReply({ content: `❌ Failed to clear provider: ${result.error}` });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Voice Provider Default Cleared')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        'Your foundational voice provider has been removed.\n\n' +
          'STT now falls through to voice-engine (free tier). ' +
          'Per-direction overrides via `/voice tts` and `/voice stt` are unaffected.'
      )
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, wasSet: result.data.wasSet }, 'Cleared voice provider default');
  } catch (error) {
    logger.error({ err: error, userId, command: 'Voice Provider Clear' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
