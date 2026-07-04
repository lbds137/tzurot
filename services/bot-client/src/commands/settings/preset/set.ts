/**
 * Settings Preset Set Handler
 * Handles /settings preset set subcommand
 */

import { EmbedBuilder } from 'discord.js';
import { DEFAULT_CONFIG_KIND } from '@tzurot/common-types/constants/ai';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { settingsPresetSetOptions } from '@tzurot/common-types/generated/commandOptions';
import { toConfigKind } from '@tzurot/common-types/services/LlmConfigMapper';
import { createLogger } from '@tzurot/common-types/utils/logger';
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
  const configId = options.preset();
  // The slot (text = chat default, or vision) decides which FK the override
  // writes; the gateway capability-gates the vision slot. Without sending it a
  // vision override silently lands in the text slot — mirror clear, which sends it.
  const kind = toConfigKind(options.slot() ?? DEFAULT_CONFIG_KIND);

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

    const result = await userClient.setModelOverride({ personalityId, configId }, { kind });

    if (!result.ok) {
      logger.warn(
        { userId, status: result.status, personalityId, configId, kind },
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
        `**${data.override.personalityName}** will now use the **${data.override.configName}** preset for ${
          kind === 'vision' ? 'vision (image)' : 'chat'
        } messages.`
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
        kind,
        reason,
      },
      'Set override'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'Preset Set' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
