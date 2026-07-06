/**
 * Settings Preset Clear Handler
 * Handles /settings preset clear subcommand
 */

import { toModelSlot } from '@tzurot/common-types/constants/ai';
import { settingsPresetClearOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../../utils/apiCheck.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { createSuccessEmbed, createInfoEmbed } from '../../../utils/commandHelpers.js';

const logger = createLogger('settings-preset-clear');

/**
 * Handle /settings preset clear
 */
export async function handleClear(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = settingsPresetClearOptions(context.interaction);
  const personalityId = options.character();
  // No slot → clear BOTH slots (`all`); an explicit slot clears just that one.
  // A vision override is a separate FK from the text override, so a no-slot
  // clear has to target both or it silently leaves the other in place.
  const slotOption = options.slot();
  const slot = slotOption !== null ? toModelSlot(slotOption) : 'all';

  if (isAutocompleteErrorSentinel(personalityId)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.deleteModelOverride(personalityId, { slot });

    if (!result.ok) {
      logger.warn({ userId, status: result.status, personalityId }, 'Failed to clear override');
      await context.editReply({ content: `❌ Failed to clear preset: ${result.error}` });
      return;
    }

    // Check if there was actually an override to remove
    const wasSet = result.data.wasSet !== false;

    const embed = wasSet
      ? createSuccessEmbed(
          '🔄 Preset Override Removed',
          'The character will now use its default preset.'
        )
      : createInfoEmbed(
          'ℹ️ No Override Set',
          'This character was already using its default preset.'
        );

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, personalityId, slot, wasSet }, 'Cleared override');
  } catch (error) {
    logger.error({ err: error, userId, command: 'Preset Clear' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
