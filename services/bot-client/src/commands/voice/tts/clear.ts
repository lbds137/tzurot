/**
 * Voice TTS Clear Handler
 * Handles /voice tts clear subcommand — clears per-character TTS override
 */

import { createLogger, voiceTtsClearOptions } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../../utils/apiCheck.js';
import { callGatewayApi, toGatewayUser } from '../../../utils/userGatewayClient.js';
import { createSuccessEmbed, createInfoEmbed } from '../../../utils/commandHelpers.js';

const logger = createLogger('voice-tts-clear');

interface ClearResponse {
  deleted: boolean;
  wasSet?: boolean;
}

/** Handle /voice tts clear */
export async function handleTtsClear(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = voiceTtsClearOptions(context.interaction);
  const personalityId = options.character();

  if (isAutocompleteErrorSentinel(personalityId)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }

  try {
    const result = await callGatewayApi<ClearResponse>(
      `/user/tts-override/${encodeURIComponent(personalityId)}`,
      {
        method: 'DELETE',
        user: toGatewayUser(context.user),
      }
    );

    if (!result.ok) {
      logger.warn({ userId, status: result.status, personalityId }, 'Failed to clear TTS override');
      await context.editReply({ content: `❌ Failed to clear TTS: ${result.error}` });
      return;
    }

    const wasSet = result.data.wasSet !== false;

    const embed = wasSet
      ? createSuccessEmbed(
          '🔄 TTS Override Removed',
          'The character will now use its default TTS config.'
        )
      : createInfoEmbed(
          'ℹ️ No Override Set',
          'This character was already using its default TTS config.'
        );

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, personalityId, wasSet }, 'Cleared TTS override');
  } catch (error) {
    logger.error({ err: error, userId, command: 'TTS Clear' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
