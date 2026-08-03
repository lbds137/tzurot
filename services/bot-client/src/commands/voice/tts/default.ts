/**
 * Voice TTS Default Handler
 * Handles /voice tts default subcommand
 *
 * One subcommand covers both directions because Discord forbids a group
 * inside a group: providing the `tts` option SETS the user's global default
 * TTS config, omitting it CLEARS it.
 */

import { EmbedBuilder } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { voiceTtsDefaultOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../../utils/apiCheck.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { checkTtsByokAccess } from './guestModeValidation.js';

const logger = createLogger('voice-tts-default');

/** Set the user's global default TTS config to `configId`. */
async function setDefault(context: DeferredCommandContext, configId: string): Promise<void> {
  const userId = context.user.id;

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
      .setFooter({ text: 'Run /voice tts default with no config to remove this setting' })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, configId, configName: data.default.configName },
      'Set default TTS config'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'Voice TTS Default Set' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}

/** Clear the user's global default TTS config. */
async function clearDefault(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.clearTtsDefaultConfig();

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, 'Failed to clear default TTS');
      await context.editReply({ content: `❌ Failed to clear default: ${result.error}` });
      return;
    }

    // Tell the user explicitly what they'll get next. Per-character
    // overrides are unaffected and surface in the second sentence.
    const fallbackLine =
      result.data.newEffectiveDefault !== null
        ? `Falling back to system default: \`${result.data.newEffectiveDefault.name}\`.`
        : 'No system default is configured; the bot will use its built-in fallback.';

    const embed = new EmbedBuilder()
      .setTitle('✅ Default TTS Config Cleared')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `Your default TTS config has been removed.\n\n${fallbackLine}\n\n` +
          'Characters with their own per-character overrides will continue to use those.'
      )
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, newDefault: result.data.newEffectiveDefault?.name ?? null },
      'Cleared default TTS config'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'Voice TTS Default Clear' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}

/** Handle /voice tts default */
export async function handleTtsDefault(context: DeferredCommandContext): Promise<void> {
  // The `tts` option is optional: present → set, absent → clear. Discord has
  // no group-in-group, so the option's presence carries the set/clear choice.
  const configId = voiceTtsDefaultOptions(context.interaction).tts();

  if (configId === null) {
    await clearDefault(context);
    return;
  }
  await setDefault(context, configId);
}
