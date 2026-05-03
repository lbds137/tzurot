/**
 * Settings TTS Default Handler
 * Handles /settings tts default subcommand
 * Sets the user's global default TTS config (applies to all personalities)
 */

import { EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS, settingsTtsDefaultOptions } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../../utils/apiCheck.js';
import { callGatewayApi, toGatewayUser } from '../../../utils/userGatewayClient.js';
import { checkTtsByokAccess } from './guestModeValidation.js';

const logger = createLogger('settings-tts-default');

interface SetDefaultResponse {
  default: {
    configId: string;
    configName: string;
  };
}

/** Handle /settings tts default */
export async function handleTtsDefault(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = settingsTtsDefaultOptions(context.interaction);
  const configId = options.tts();

  // Guard the autocomplete-backed `tts` option. If autocomplete failed
  // (gateway down) the sentinel would otherwise flow into the gateway
  // PUT and surface as an opaque "Invalid configId format" error.
  if (isAutocompleteErrorSentinel(configId)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }

  try {
    const user = toGatewayUser(context.user);

    // BYOK gate: block at command time if config requires a provider key
    // the user hasn't configured. Self-hosted always allowed; mistral and
    // elevenlabs require BYOK keys.
    const outcome = await checkTtsByokAccess(context, configId, user);
    if (outcome.blocked) {
      return;
    }

    const result = await callGatewayApi<SetDefaultResponse>('/user/tts-override/default', {
      method: 'PUT',
      user,
      body: { configId },
    });

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
          'This will be used for all personalities unless you have a specific override.'
      )
      .setFooter({ text: 'Use /settings tts clear-default to remove this setting' })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, configId, configName: data.default.configName },
      'Set default TTS config'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'TTS Default' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
