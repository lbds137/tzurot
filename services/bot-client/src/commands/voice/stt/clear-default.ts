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
      .setTitle('✅ Default STT Provider Cleared')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        'Your default STT provider has been removed.\n\n' +
          'Cascade now resolves via TTS-derived → admin default → voice-engine fallback.'
      )
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info({ userId }, 'Cleared default STT provider');
  } catch (error) {
    logger.error({ err: error, userId, command: 'STT Clear-Default' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
