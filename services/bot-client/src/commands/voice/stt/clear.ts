/**
 * Voice STT Clear Handler
 *
 * Handles /voice stt clear <personality> — removes the per-personality
 * transcription preference. Subsequent voice messages to that personality
 * use the user's default transcription provider (or the free fallback).
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
      logger.warn(
        { userId, status: result.status, personalityId },
        'Failed to clear transcription preference'
      );
      await context.editReply({
        content: `❌ Failed to clear transcription preference: ${result.error}`,
      });
      return;
    }

    const wasSet = result.data.wasSet !== false;
    const embed = wasSet
      ? createSuccessEmbed(
          '✅ Transcription Preference Removed',
          'This personality will now use your default transcription provider.'
        )
      : createInfoEmbed(
          'ℹ️ Nothing to Remove',
          'This personality has no transcription preference set.'
        );

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, personalityId, wasSet }, 'Cleared transcription preference');
  } catch (error) {
    logger.error({ err: error, userId, command: 'voice stt clear' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
