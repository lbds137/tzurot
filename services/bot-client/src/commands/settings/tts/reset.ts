/**
 * Settings TTS Reset Handler
 * Handles /settings tts reset subcommand — clears per-personality TTS override
 */

import { createLogger, settingsTtsResetOptions } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../../utils/apiCheck.js';
import { callGatewayApi, toGatewayUser } from '../../../utils/userGatewayClient.js';
import { createSuccessEmbed, createInfoEmbed } from '../../../utils/commandHelpers.js';

const logger = createLogger('settings-tts-reset');

interface ResetResponse {
  deleted: boolean;
  wasSet?: boolean;
}

/** Handle /settings tts reset */
export async function handleTtsReset(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = settingsTtsResetOptions(context.interaction);
  const personalityId = options.personality();

  if (isAutocompleteErrorSentinel(personalityId)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }

  try {
    const result = await callGatewayApi<ResetResponse>(
      `/user/tts-override/${encodeURIComponent(personalityId)}`,
      {
        method: 'DELETE',
        user: toGatewayUser(context.user),
      }
    );

    if (!result.ok) {
      logger.warn({ userId, status: result.status, personalityId }, 'Failed to reset TTS override');
      await context.editReply({ content: `❌ Failed to reset TTS: ${result.error}` });
      return;
    }

    const wasSet = result.data.wasSet !== false;

    const embed = wasSet
      ? createSuccessEmbed(
          '🔄 TTS Override Removed',
          'The personality will now use its default TTS config.'
        )
      : createInfoEmbed(
          'ℹ️ No Override Set',
          'This personality was already using its default TTS config.'
        );

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, personalityId, wasSet }, 'Reset TTS override');
  } catch (error) {
    logger.error({ err: error, userId, command: 'TTS Reset' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
