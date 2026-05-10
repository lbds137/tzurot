/**
 * Voice STT Set Handler
 * Handles /voice stt set <personality> <provider> — Layer 1 of the STT cascade
 * (per-personality override on User PersonalityConfig.sttProviderId).
 */

import { EmbedBuilder } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  voiceSttSetOptions,
  sttProviderDisplayName,
  type SetSttOverrideResponse,
  type SttProvider,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../../utils/apiCheck.js';
import { callGatewayApi, toGatewayUser } from '../../../utils/userGatewayClient.js';

const logger = createLogger('voice-stt-set');

/** Handle /voice stt set */
export async function handleSttSet(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = voiceSttSetOptions(context.interaction);
  const personalityId = options.personality();
  const providerId = options.provider() as SttProvider;

  if (isAutocompleteErrorSentinel(personalityId)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }

  try {
    const result = await callGatewayApi<SetSttOverrideResponse>('/user/stt-override', {
      method: 'PUT',
      user: toGatewayUser(context.user),
      body: { personalityId, providerId },
    });

    if (!result.ok) {
      logger.warn(
        { userId, status: result.status, personalityId, providerId },
        'Failed to set STT override'
      );
      await context.editReply({ content: `❌ Failed to set STT override: ${result.error}` });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ STT Override Set')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `**${result.data.override.personalityName}** will now use **${sttProviderDisplayName(providerId)}** for transcription.`
      )
      .setFooter({ text: 'Use /voice stt clear to remove this override' })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, personalityId, personalityName: result.data.override.personalityName, providerId },
      'Set STT override'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'STT Set' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
