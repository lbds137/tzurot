/**
 * Voice STT Set Handler
 * Handles /voice stt set <provider> — writes User.defaultSttProviderId
 * (the user's transcription preference). One per user; STT is speaker-bound
 * so there's no per-character dimension.
 */

import { EmbedBuilder } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { voiceSttSetOptions } from '@tzurot/common-types/generated/commandOptions';
import { sttProviderDisplayName, type SttProvider } from '@tzurot/common-types/types/sttProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { clientsFor } from '../../../utils/gatewayClients.js';

const logger = createLogger('voice-stt-set');

/** Handle /voice stt set */
export async function handleSttSet(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = voiceSttSetOptions(context.interaction);
  const providerId = options.provider() as SttProvider;

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.setSttDefaultProvider({ providerId });

    if (!result.ok) {
      logger.warn(
        { userId, status: result.status, providerId },
        'Failed to set transcription provider'
      );
      await context.editReply({
        content: `❌ Failed to set transcription provider: ${result.error}`,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Transcription Provider Set')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `🎤 **${sttProviderDisplayName(providerId)}** will now transcribe your voice messages.`
      )
      .setFooter({ text: 'Use /voice stt clear to remove this preference' })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, providerId }, 'Set transcription provider');
  } catch (error) {
    logger.error({ err: error, userId, command: 'voice stt set' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
