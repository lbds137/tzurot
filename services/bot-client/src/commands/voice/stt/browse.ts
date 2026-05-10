/**
 * Voice STT Browse Handler
 * Handles /voice stt browse — lists per-personality STT overrides + the
 * user-default. Compact summary, no pagination yet (low row count expected).
 */

import { EmbedBuilder } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  sttProviderDisplayName,
  type ListSttOverridesResponse,
  type GetVoiceProviderResponse,
  type SttProvider,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi, toGatewayUser } from '../../../utils/userGatewayClient.js';

const logger = createLogger('voice-stt-browse');

/** Handle /voice stt browse */
export async function handleSttBrowse(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const user = toGatewayUser(context.user);

  try {
    const [overridesResult, defaultResult, providerResult] = await Promise.all([
      callGatewayApi<ListSttOverridesResponse>('/user/stt-override', { method: 'GET', user }),
      callGatewayApi<{ default: { providerId: SttProvider | null } }>(
        '/user/stt-override/default',
        { method: 'GET', user }
      ),
      callGatewayApi<GetVoiceProviderResponse>('/user/voice-provider', { method: 'GET', user }),
    ]);

    if (!overridesResult.ok) {
      await context.editReply({
        content: `❌ Failed to fetch STT overrides: ${overridesResult.error}`,
      });
      return;
    }

    const overrides = overridesResult.data.overrides;
    const userDefault =
      defaultResult.ok && defaultResult.data.default.providerId !== null
        ? sttProviderDisplayName(defaultResult.data.default.providerId)
        : null;
    const voiceProviderDefault =
      providerResult.ok && providerResult.data.providerId !== null
        ? sttProviderDisplayName(providerResult.data.providerId)
        : null;

    const lines: string[] = [];
    lines.push(`**Default transcription provider:** ${userDefault ?? '_(not set)_'}`);
    lines.push(`**Default voice provider:** ${voiceProviderDefault ?? '_(not set)_'}`);
    lines.push('');

    if (overrides.length === 0) {
      lines.push('_No per-personality transcription preferences set._');
      lines.push(
        'Use `/voice stt set <personality> <provider>` to pick a transcription provider for a specific personality.'
      );
    } else {
      lines.push(`**Per-personality preferences (${overrides.length}):**`);
      for (const o of overrides) {
        const providerLabel =
          o.providerId !== null ? sttProviderDisplayName(o.providerId) : '_(cleared)_';
        lines.push(`• **${o.personalityName}** → ${providerLabel}`);
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('🎤 Your Transcription Settings')
      .setColor(DISCORD_COLORS.BLURPLE)
      .setDescription(lines.join('\n'))
      .setFooter({
        text: 'Per-personality preferences win over your defaults.',
      })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, count: overrides.length }, 'Browsed STT overrides');
  } catch (error) {
    logger.error({ err: error, userId, command: 'STT Browse' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
