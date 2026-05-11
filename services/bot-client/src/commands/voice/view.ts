/**
 * Voice View Handler
 * Handles /voice view <character> — character-scoped dashboard showing the
 * resolved TTS provider and STT provider for the picked character. Single
 * round-trip via /user/voice-resolution.
 *
 * Cascade labels are written so each line reads as "the setting resolved
 * FOR THIS CHARACTER" — even when the resolved value falls through to a
 * user-default tier, the framing keeps the character scope explicit.
 *
 * The cloned-voice library (user-scoped, not character-specific) lives in
 * `/voice voices browse` — intentionally NOT shown here because it's not
 * tied to the picked character.
 */

import { EmbedBuilder, escapeMarkdown } from 'discord.js';
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

/**
 * Friendly description of why this provider was chosen for transcription.
 *
 * STT is user-scoped (your voice doesn't change per character), so we don't
 * frame the label as "for this character" — that would imply scope it doesn't
 * have. The label describes the cascade tier hit instead.
 */
function sttSourceLabel(source: SttResolutionSource): string {
  switch (source) {
    case 'user-default':
      return 'your transcription preference';
    case 'tts-derived':
      return 'matches your TTS choice';
    case 'hardcoded':
      return 'free fallback';
  }
}

/**
 * Friendly description of why this TTS provider was chosen for the character.
 *
 * TTS resolution IS character-scoped — labels lean into that to make clear
 * the view is showing what's resolved FOR THIS CHARACTER, including when the
 * resolution falls through to a user-default or system-default tier.
 */
function ttsSourceLabel(source: TtsResolutionSource): string {
  switch (source) {
    case 'user-personality':
      return 'set for this character';
    case 'user-default':
      return 'falls back to your TTS default — no character-specific override';
    case 'personality':
      return 'character default';
    case 'free-default':
      return 'system default';
    case 'hardcoded':
      return 'free fallback';
  }
}

/** Handle /voice view */
export async function handleVoiceView(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = voiceViewOptions(context.interaction);
  const personalityId = options.character();

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

    const { personalityName, tts, stt } = result.data;

    const ttsLine =
      tts.configName !== null
        ? `**${tts.configName}** _(${tts.provider}, ${ttsSourceLabel(tts.source)})_`
        : `**${tts.provider}** _(${ttsSourceLabel(tts.source)})_`;

    const sttProviderLabel = isSttProvider(stt.provider)
      ? sttProviderDisplayName(stt.provider)
      : stt.provider;
    const sttLine = `**${sttProviderLabel}** _(${sttSourceLabel(stt.source)})_`;

    const embed = new EmbedBuilder()
      .setTitle(`🎙️ Voice Settings for ${escapeMarkdown(personalityName)}`)
      .setColor(DISCORD_COLORS.BLURPLE)
      .addFields(
        { name: '🔊 TTS (speaks as character)', value: ttsLine, inline: false },
        { name: '🎤 STT (transcribes your voice)', value: sttLine, inline: false }
      )
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
