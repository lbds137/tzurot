/**
 * Voice Provider Set Handler
 * Handles /voice provider set <provider> — writes User.defaultProvider
 * (Layer 4 of the STT cascade). The foundational baseline that surgical
 * TTS / STT overrides layer above.
 */

import { EmbedBuilder } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  voiceProviderSetOptions,
  sttProviderDisplayName,
  type SetVoiceProviderResponse,
  type SttProvider,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi, toGatewayUser } from '../../../utils/userGatewayClient.js';

const logger = createLogger('voice-provider-set');

/** Handle /voice provider set */
export async function handleProviderSet(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = voiceProviderSetOptions(context.interaction);
  const providerId = options.provider() as SttProvider;

  try {
    const result = await callGatewayApi<SetVoiceProviderResponse>('/user/voice-provider', {
      method: 'PUT',
      user: toGatewayUser(context.user),
      body: { providerId },
    });

    if (!result.ok) {
      logger.warn({ userId, status: result.status, providerId }, 'Failed to set voice provider');
      await context.editReply({ content: `❌ Failed to set provider: ${result.error}` });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Voice Provider Default Set')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `Your foundational voice provider is now **${sttProviderDisplayName(providerId)}**.\n\n` +
          'This is the baseline both TTS and STT cascade through if no other layer wins. ' +
          'Use `/voice tts set-default` or `/voice stt set-default` to override on a per-direction basis.'
      )
      .setFooter({ text: 'Use /voice provider clear to remove this setting' })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, providerId }, 'Set voice provider default');
  } catch (error) {
    logger.error({ err: error, userId, command: 'Voice Provider Set' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
