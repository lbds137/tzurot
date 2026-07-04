/**
 * Voice TTS Set Handler
 * Handles /voice tts set subcommand — overrides TTS config for a character.
 */

import { EmbedBuilder } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { voiceTtsSetOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../../utils/apiCheck.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { checkTtsByokAccess } from './guestModeValidation.js';

const logger = createLogger('voice-tts-set');

/** Handle /voice tts set */
export async function handleTtsSet(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = voiceTtsSetOptions(context.interaction);
  const personalityId = options.character();
  const configId = options.tts();

  if (isAutocompleteErrorSentinel(personalityId) || isAutocompleteErrorSentinel(configId)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }

  try {
    const { userClient } = clientsFor(context.interaction);

    const outcome = await checkTtsByokAccess(context, configId, userClient);
    if (outcome.blocked) {
      return;
    }

    const result = await userClient.setTtsOverride({ personalityId, configId });

    if (!result.ok) {
      logger.warn(
        { userId, status: result.status, personalityId, configId },
        'Failed to set TTS override'
      );
      await context.editReply({ content: `❌ Failed to set TTS: ${result.error}` });
      return;
    }

    const data = result.data;

    const embed = new EmbedBuilder()
      .setTitle('✅ TTS Override Set')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `**${data.override.personalityName}** will now use the **${data.override.configName}** TTS config.`
      )
      .setFooter({ text: 'Use /voice tts clear to remove this override' })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info(
      {
        userId,
        personalityId,
        personalityName: data.override.personalityName,
        configId,
        configName: data.override.configName,
        reason: outcome.reason,
      },
      'Set TTS override'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'voice tts set' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
