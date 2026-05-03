/**
 * Settings TTS Browse Handler
 * Handles /settings tts browse — lists user's per-personality TTS overrides
 *
 * Mirrors `/settings preset browse` shape: shows the user's overrides, not
 * the underlying TtsConfig catalog. (The catalog is implicit through
 * autocomplete; users don't need a separate "list all configs" view in v1.)
 */

import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { createLogger, DISCORD_COLORS, type TtsOverrideSummary } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import {
  callGatewayApi,
  GATEWAY_TIMEOUTS,
  toGatewayUser,
} from '../../../utils/userGatewayClient.js';

const logger = createLogger('settings-tts-browse');

interface ListResponse {
  overrides: TtsOverrideSummary[];
}

/** Handle /settings tts browse */
export async function handleTtsBrowseOverrides(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const result = await callGatewayApi<ListResponse>('/user/tts-override', {
      user: toGatewayUser(context.user),
      timeout: GATEWAY_TIMEOUTS.DEFERRED,
    });

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
          'Use `/settings tts set` to override which TTS config a personality uses, or ' +
          '`/settings tts default` to set your global default.'
      );
    } else {
      const lines = data.overrides.map(
        o =>
          `**${escapeMarkdown(o.personalityName)}** → ${escapeMarkdown(o.configName ?? 'Unknown')}`
      );

      embed.setDescription(lines.join('\n'));
      embed.setFooter({
        text: `${data.overrides.length} override(s) • Use /settings tts reset to remove`,
      });
    }

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, count: data.overrides.length }, 'Listed TTS overrides');
  } catch (error) {
    logger.error({ err: error, userId, command: 'TTS Browse' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
