/**
 * Voice View Handler
 * Handles /voice view <personality> — unified dashboard showing the
 * resolved TTS provider, resolved STT provider (with cascade source layer),
 * and a cloned-voice summary. Single round-trip via /user/voice-resolution.
 */

import { EmbedBuilder } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  voiceViewOptions,
  sttProviderDisplayName,
  isSttProvider,
  type GetVoiceResolutionResponse,
  type SttResolutionSource,
  type TtsResolutionSource,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../utils/apiCheck.js';
import { callGatewayApi, toGatewayUser } from '../../utils/userGatewayClient.js';

const logger = createLogger('voice-view');

/** User-friendly name for an STT cascade source layer. */
function sttSourceLabel(source: SttResolutionSource): string {
  switch (source) {
    case 'user-personality':
      return 'per-personality override';
    case 'user-default':
      return 'your user-default';
    case 'tts-derived':
      return 'derived from your TTS choice';
    case 'admin-default':
      return 'your /voice provider baseline';
    case 'hardcoded':
      return 'free-tier fallback';
  }
}

/** User-friendly name for a TTS cascade source layer. */
function ttsSourceLabel(source: TtsResolutionSource): string {
  switch (source) {
    case 'user-personality':
      return 'per-personality override';
    case 'user-default':
      return 'your user-default';
    case 'personality':
      return 'personality default';
    case 'free-default':
      return 'system free default';
    case 'hardcoded':
      return 'self-hosted fallback';
  }
}

/** Handle /voice view */
export async function handleVoiceView(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = voiceViewOptions(context.interaction);
  const personalityId = options.personality();

  if (isAutocompleteErrorSentinel(personalityId)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }

  try {
    const result = await callGatewayApi<GetVoiceResolutionResponse>(
      `/user/voice-resolution?personalityId=${encodeURIComponent(personalityId)}`,
      { method: 'GET', user: toGatewayUser(context.user) }
    );

    if (!result.ok) {
      logger.warn({ userId, personalityId, status: result.status }, 'Failed to resolve voice view');
      await context.editReply({ content: `❌ Failed to fetch voice settings: ${result.error}` });
      return;
    }

    const { tts, stt, voices } = result.data;

    const ttsLine =
      tts.configName !== null
        ? `**${tts.configName}** _(${tts.provider}, ${ttsSourceLabel(tts.source)})_`
        : `**${tts.provider}** _(${ttsSourceLabel(tts.source)})_`;

    const sttProviderLabel = isSttProvider(stt.provider)
      ? sttProviderDisplayName(stt.provider)
      : stt.provider;
    const sttLine = `**${sttProviderLabel}** _(${sttSourceLabel(stt.source)})_`;

    let voicesLine: string;
    if (voices.tzurotCount === 0) {
      voicesLine = '_No cloned voices yet._ Use `/voice voices ...` to manage cloned voices.';
    } else if (voices.previewSlugs.length === voices.tzurotCount) {
      voicesLine = `**${voices.tzurotCount}** cloned voice${voices.tzurotCount === 1 ? '' : 's'}: ${voices.previewSlugs.map(s => `\`${s}\``).join(', ')}`;
    } else {
      voicesLine =
        `**${voices.tzurotCount}** cloned voice${voices.tzurotCount === 1 ? '' : 's'} (showing first ${voices.previewSlugs.length}): ` +
        `${voices.previewSlugs.map(s => `\`${s}\``).join(', ')} — see \`/voice voices browse\` for full list`;
    }

    const embed = new EmbedBuilder()
      .setTitle('🎙️ Voice Settings')
      .setColor(DISCORD_COLORS.BLURPLE)
      .addFields(
        { name: '🔊 Active TTS', value: ttsLine, inline: false },
        { name: '🎤 Active STT', value: sttLine, inline: false },
        { name: '📚 Cloned Voices', value: voicesLine, inline: false }
      )
      .setFooter({
        text: 'Cascade: per-personality > user-default > TTS-derived > admin > fallback',
      })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info(
      {
        userId,
        personalityId,
        ttsProvider: tts.provider,
        ttsSource: tts.source,
        sttProvider: stt.provider,
        sttSource: stt.source,
      },
      'Showed voice view'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'Voice View' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
