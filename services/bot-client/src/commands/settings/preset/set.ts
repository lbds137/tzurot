/**
 * Settings Preset Set Handler
 * Handles /settings preset set subcommand
 */

import { EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS, settingsPresetSetOptions } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../../utils/apiCheck.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { handleUnlockModelsUpsell, checkGuestModePremiumAccess } from './guestModeValidation.js';

const logger = createLogger('settings-preset-set');

/**
 * Handle /settings preset set
 */
export async function handleSet(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = settingsPresetSetOptions(context.interaction);
  const personalityId = options.character();
  // The `kind` option only scopes the preset autocomplete; the route infers
  // kind from the chosen config row, so it isn't read or sent here.
  const configId = options.preset();

  if (isAutocompleteErrorSentinel(personalityId)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }

  if (await handleUnlockModelsUpsell(context, configId, userId)) {
    return;
  }

  try {
    const { userClient } = clientsFor(context.interaction);
    const outcome = await checkGuestModePremiumAccess(context, configId, userClient);
    if (outcome.blocked) {
      return;
    }
    const { reason } = outcome;

    const result = await userClient.setModelOverride({ personalityId, configId });

    if (!result.ok) {
      logger.warn(
        { userId, status: result.status, personalityId, configId },
        'Failed to set override'
      );
      await context.editReply({ content: `❌ Failed to set preset: ${result.error}` });
      return;
    }

    const data = result.data;

    const embed = new EmbedBuilder()
      .setTitle('✅ Preset Override Set')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `**${data.override.personalityName}** will now use the **${data.override.configName}** preset.`
      )
      .setFooter({ text: 'Use /settings preset clear to remove this override' })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info(
      {
        userId,
        personalityId,
        personalityName: data.override.personalityName,
        configId,
        configName: data.override.configName,
        reason,
      },
      'Set override'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'Preset Set' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
