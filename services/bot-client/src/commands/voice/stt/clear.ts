/**
 * Voice STT Clear Handler
 * Handles /voice stt clear — clears the user's transcription provider
 * preference. Subsequent voice messages will derive from the user's default
 * TTS (BYOK pairs like Mistral) or fall back to the self-hosted engine.
 */

import { EmbedBuilder } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { clientsFor } from '../../../utils/gatewayClients.js';

const logger = createLogger('voice-stt-clear');

/** Handle /voice stt clear */
export async function handleSttClear(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.clearSttDefaultProvider();

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, 'Failed to clear transcription preference');
      await context.editReply({ content: `❌ Failed to clear: ${result.error}` });
      return;
    }

    const wasSet = result.data.wasSet !== false;
    const embed = wasSet
      ? new EmbedBuilder()
          .setTitle('✅ Transcription Preference Cleared')
          .setColor(DISCORD_COLORS.SUCCESS)
          .setDescription(
            'Voice messages will now follow the same provider you use for speaking, or fall back to the free self-hosted engine.'
          )
          .setTimestamp()
      : new EmbedBuilder()
          .setTitle('ℹ️ Nothing to Clear')
          .setColor(DISCORD_COLORS.BLURPLE)
          .setDescription('You had no transcription preference set.')
          .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, wasSet }, 'Cleared transcription preference');
  } catch (error) {
    logger.error({ err: error, userId, command: 'voice stt clear' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
