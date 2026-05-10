/**
 * Voice STT Clear Handler
 * Handles /voice stt clear <personality> — clears the per-personality STT
 * override (Layer 1 of the cascade). Cascade falls through to user-default
 * (Layer 2) on the next transcription for that personality.
 */

import {
  createLogger,
  voiceSttClearOptions,
  type DeleteSttOverrideResponse,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../../utils/apiCheck.js';
import { callGatewayApi, toGatewayUser } from '../../../utils/userGatewayClient.js';
import { createSuccessEmbed, createInfoEmbed } from '../../../utils/commandHelpers.js';

const logger = createLogger('voice-stt-clear');

/** Handle /voice stt clear */
export async function handleSttClear(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = voiceSttClearOptions(context.interaction);
  const personalityId = options.personality();

  if (isAutocompleteErrorSentinel(personalityId)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }

  try {
    const result = await callGatewayApi<DeleteSttOverrideResponse>(
      `/user/stt-override/${encodeURIComponent(personalityId)}`,
      {
        method: 'DELETE',
        user: toGatewayUser(context.user),
      }
    );

    if (!result.ok) {
      logger.warn({ userId, status: result.status, personalityId }, 'Failed to clear STT override');
      await context.editReply({ content: `❌ Failed to clear STT: ${result.error}` });
      return;
    }

    const wasSet = result.data.wasSet !== false;
    const embed = wasSet
      ? createSuccessEmbed(
          '🔄 STT Override Removed',
          'The personality will now use the cascade fallback for transcription.'
        )
      : createInfoEmbed('ℹ️ No Override Set', 'This personality had no STT override.');

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, personalityId, wasSet }, 'Cleared STT override');
  } catch (error) {
    logger.error({ err: error, userId, command: 'STT Clear' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
