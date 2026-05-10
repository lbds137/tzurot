/**
 * Voice TTS Set Handler
 * Handles /voice tts set subcommand — overrides TTS config for a personality
 */

import { EmbedBuilder } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  isSttProvider,
  sttProviderDisplayName,
  voiceTtsSetOptions,
  type GetVoiceResolutionResponse,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../../utils/apiCheck.js';
import {
  callGatewayApi,
  toGatewayUser,
  type GatewayUser,
} from '../../../utils/userGatewayClient.js';
import { checkTtsByokAccess } from './guestModeValidation.js';

const logger = createLogger('voice-tts-set');

interface SetResponse {
  override: {
    personalityId: string;
    personalityName: string;
    configId: string | null;
    configName: string | null;
  };
}

/** Handle /voice tts set */
export async function handleTtsSet(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = voiceTtsSetOptions(context.interaction);
  const personalityId = options.personality();
  const configId = options.tts();

  // Guard both autocomplete-backed options. If either flowed the sentinel
  // through, surface the friendly unavailable-message instead of letting
  // the gateway reject with `Invalid configId format`.
  if (isAutocompleteErrorSentinel(personalityId) || isAutocompleteErrorSentinel(configId)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }

  try {
    const user = toGatewayUser(context.user);

    const outcome = await checkTtsByokAccess(context, configId, user);
    if (outcome.blocked) {
      return;
    }

    // Capture pre-write STT resolution to detect cascade-induced changes
    // for the JIT teaching footer below. Best-effort — failure here just
    // means the footer doesn't fire, which is fine.
    const oldStt = await fetchStt(personalityId, user);

    const result = await callGatewayApi<SetResponse>('/user/tts-override', {
      method: 'PUT',
      user,
      body: { personalityId, configId },
    });

    if (!result.ok) {
      logger.warn(
        { userId, status: result.status, personalityId, configId },
        'Failed to set TTS override'
      );
      await context.editReply({ content: `❌ Failed to set TTS: ${result.error}` });
      return;
    }

    const data = result.data;

    // Re-resolve STT after the TTS write. If the new TTS choice cascaded
    // into a different STT provider via Layer 3 (tts-derived), fire a
    // smart footer to teach the user about the dependency. The check is
    // narrow (`source === 'tts-derived'` AND provider changed) so we don't
    // misattribute coincidental changes to user actions.
    const newStt = await fetchStt(personalityId, user);
    const sttFooter = buildSttDerivedFooter(oldStt, newStt);

    const embed = new EmbedBuilder()
      .setTitle('✅ TTS Override Set')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `**${data.override.personalityName}** will now use the **${data.override.configName}** TTS config.`
      )
      .setFooter({
        text: sttFooter ?? 'Use /voice tts clear to remove this override',
      })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info(
      {
        userId,
        personalityId,
        personalityName: data.override.personalityName,
        configId,
        configName: data.override.configName,
        reason: outcome.reason,
      },
      'Set TTS override'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'TTS Set' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}

/** Resolved STT view used by the JIT footer. Best-effort fetch — null on failure. */
type SttSnapshot = GetVoiceResolutionResponse['stt'] | null;

async function fetchStt(personalityId: string, user: GatewayUser): Promise<SttSnapshot> {
  // Best-effort: swallow exceptions so a transient gateway failure on the
  // post-write call doesn't surface as a generic "error" message after the
  // TTS write has already succeeded (which would invite the user to retry
  // and overwrite their setting). Footer is decorative, not load-bearing.
  try {
    const result = await callGatewayApi<GetVoiceResolutionResponse>(
      `/user/voice-resolution?personalityId=${encodeURIComponent(personalityId)}`,
      { method: 'GET', user }
    );
    return result.ok ? result.data.stt : null;
  } catch {
    return null;
  }
}

/**
 * Build a JIT teaching footer when the TTS write changed the resolved STT
 * via Layer 3 (tts-derived). Returns null when no footer should fire.
 *
 * Conditions:
 *   - both snapshots resolved successfully (best-effort)
 *   - new STT is sourced from tts-derived (otherwise the change wasn't TTS's fault)
 *   - provider actually flipped
 */
function buildSttDerivedFooter(oldStt: SttSnapshot, newStt: SttSnapshot): string | null {
  if (oldStt === null || newStt === null) {
    return null;
  }
  if (newStt.source !== 'tts-derived') {
    return null;
  }
  if (oldStt.provider === newStt.provider) {
    return null;
  }

  const newLabel = isSttProvider(newStt.provider)
    ? sttProviderDisplayName(newStt.provider)
    : newStt.provider;
  const oldLabel = isSttProvider(oldStt.provider)
    ? sttProviderDisplayName(oldStt.provider)
    : oldStt.provider;

  return `ℹ️ STT now resolves to ${newLabel} (was ${oldLabel}) via your TTS choice. Use /voice stt set to override.`;
}
