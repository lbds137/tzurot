/**
 * Voice TTS List Handler
 * Handles /voice tts list — lists user's per-character TTS overrides
 *
 * Mirrors `/settings preset list` shape: shows the user's overrides, not
 * the underlying TtsConfig catalog. (The catalog is implicit through
 * autocomplete; users don't need a separate "list all configs" view in v1.)
 */

import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { clientsFor } from '../../../utils/gatewayClients.js';

const logger = createLogger('voice-tts-browse');

/** Handle /voice tts list */
export async function handleTtsListOverrides(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.listTtsOverrides();

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, 'Failed to list TTS overrides');
      await context.editReply({
        content: '❌ Failed to get TTS overrides. Please try again later.',
      });
      return;
    }

    const data = result.data;

    const embed = new EmbedBuilder()
      .setTitle('🔊 Your TTS Overrides')
      .setColor(DISCORD_COLORS.BLURPLE)
      .setTimestamp();

    if (data.overrides.length === 0) {
      embed.setDescription(
        "You haven't set any TTS overrides.\n\n" +
          'Use `/voice tts set` to override which TTS config a character uses, or ' +
          '`/voice tts set-default` to set your global default.'
      );
    } else {
      const lines = data.overrides.map(
        o =>
          `**${escapeMarkdown(o.personalityName)}** → ${escapeMarkdown(o.configName ?? 'Unknown')}`
      );

      embed.setDescription(lines.join('\n'));
      embed.setFooter({
        text: `${data.overrides.length} override(s) • Use /voice tts clear to remove`,
      });
    }

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, count: data.overrides.length }, 'Listed TTS overrides');
  } catch (error) {
    logger.error({ err: error, userId, command: 'TTS Browse' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
