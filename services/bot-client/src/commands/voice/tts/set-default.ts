/**
 * Voice TTS Set-Default Handler
 * Handles /voice tts set-default subcommand
 * Sets the user's global default TTS config (applies to all characters)
 */

import { EmbedBuilder } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { voiceTtsSetDefaultOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../../utils/apiCheck.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { checkTtsByokAccess } from './guestModeValidation.js';

const logger = createLogger('voice-tts-set-default');

/** Handle /voice tts set-default */
export async function handleTtsSetDefault(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = voiceTtsSetDefaultOptions(context.interaction);
  const configId = options.tts();

  // Guard the autocomplete-backed `tts` option. If autocomplete failed
  // (gateway down) the sentinel would otherwise flow into the gateway
  // PUT and surface as an opaque "Invalid configId format" error.
  if (isAutocompleteErrorSentinel(configId)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }

  try {
    const { userClient } = clientsFor(context.interaction);

    // BYOK gate: block at command time if config requires a provider key
    // the user hasn't configured. Self-hosted always allowed; mistral and
    // elevenlabs require BYOK keys.
    const outcome = await checkTtsByokAccess(context, configId, userClient);
    if (outcome.blocked) {
      return;
    }

    const result = await userClient.setTtsDefaultConfig({ configId });

    if (!result.ok) {
      logger.warn({ userId, status: result.status, configId }, 'Failed to set default TTS');
      await context.editReply({ content: `❌ Failed to set default: ${result.error}` });
      return;
    }

    const data = result.data;

    const embed = new EmbedBuilder()
      .setTitle('✅ Default TTS Config Set')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `Your default TTS config is now **${data.default.configName}**.\n\n` +
          'This will be used for all characters unless you have a specific override.'
      )
      .setFooter({ text: 'Use /voice tts clear-default to remove this setting' })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, configId, configName: data.default.configName },
      'Set default TTS config'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'TTS Set-Default' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
