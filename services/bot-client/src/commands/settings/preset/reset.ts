/**
 * Settings Preset Reset Handler
 * Handles /settings preset reset subcommand
 */

import { createLogger, settingsPresetResetOptions } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../../utils/apiCheck.js';
import { callGatewayApi, toGatewayUser } from '../../../utils/userGatewayClient.js';
import { createSuccessEmbed, createInfoEmbed } from '../../../utils/commandHelpers.js';

const logger = createLogger('settings-preset-reset');

interface ResetResponse {
  deleted: boolean;
  wasSet?: boolean; // false if no override existed
}

/**
 * Handle /settings preset reset
 */
export async function handleReset(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = settingsPresetResetOptions(context.interaction);
  const personalityId = options.personality();

  if (isAutocompleteErrorSentinel(personalityId)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }

  try {
    const result = await callGatewayApi<ResetResponse>(
      `/user/model-override/${encodeURIComponent(personalityId)}`,
      {
        method: 'DELETE',
        user: toGatewayUser(context.user),
      }
    );

    if (!result.ok) {
      logger.warn({ userId, status: result.status, personalityId }, 'Failed to reset override');
      await context.editReply({ content: `❌ Failed to reset preset: ${result.error}` });
      return;
    }

    // Check if there was actually an override to remove
    const wasSet = result.data.wasSet !== false;

    const embed = wasSet
      ? createSuccessEmbed(
          '🔄 Preset Override Removed',
          'The personality will now use its default preset.'
        )
      : createInfoEmbed(
          'ℹ️ No Override Set',
          'This personality was already using its default preset.'
        );

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, personalityId, wasSet }, 'Reset override');
  } catch (error) {
    logger.error({ err: error, userId, command: 'Preset Reset' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
