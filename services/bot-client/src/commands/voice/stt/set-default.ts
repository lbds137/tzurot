/**
 * Voice STT Set-Default Handler
 * Handles /voice stt set-default <provider> — Layer 2 of the STT cascade
 * (User.defaultSttProviderId).
 */

import { EmbedBuilder } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  voiceSttSetDefaultOptions,
  sttProviderDisplayName,
  type SetSttDefaultProviderResponse,
  type SttProvider,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi, toGatewayUser } from '../../../utils/userGatewayClient.js';

const logger = createLogger('voice-stt-set-default');

/** Handle /voice stt set-default */
export async function handleSttSetDefault(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = voiceSttSetDefaultOptions(context.interaction);
  const providerId = options.provider() as SttProvider;

  try {
    const result = await callGatewayApi<SetSttDefaultProviderResponse>(
      '/user/stt-override/default',
      {
        method: 'PUT',
        user: toGatewayUser(context.user),
        body: { providerId },
      }
    );

    if (!result.ok) {
      logger.warn({ userId, status: result.status, providerId }, 'Failed to set default STT');
      await context.editReply({ content: `❌ Failed to set default: ${result.error}` });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Default STT Provider Set')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `Your default STT provider is now **${sttProviderDisplayName(providerId)}**.\n\n` +
          'Personalities without their own per-personality STT override will use this. ' +
          'Personalities with overrides are unaffected.'
      )
      .setFooter({ text: 'Use /voice stt clear-default to remove this setting' })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, providerId }, 'Set default STT provider');
  } catch (error) {
    logger.error({ err: error, userId, command: 'STT Set-Default' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
