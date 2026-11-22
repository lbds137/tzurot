/**
 * Voice Replies Handler
 * Handles /voice replies <character> <mode> — writes the per-character
 * Voice Response Mode override (the same user-personality tier the
 * `/character overrides` dashboard's Voice page writes), then reads
 * /user/voice-resolution with `skipVoices=true` for the character's name and
 * voice-enabled state while verifying the cascade read-back matches the write.
 *
 * `/voice view` renders the same pair of facts read-only; this command is
 * the write path that reaches it without opening a dashboard.
 */

import { escapeMarkdown } from 'discord.js';
import { voiceRepliesOptions } from '@tzurot/common-types/generated/commandOptions';
import { VOICE_RESPONSE_MODES, type VoiceResponseMode } from '@tzurot/common-types/constants/voice';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../utils/apiCheck.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { voiceModeSourceLabel, voiceModeValueLabel } from './modeLabels.js';

const logger = createLogger('voice-replies');

// One wording for the resource name across every failure shape and the log field.
const VOICE_REPLIES_RESOURCE = 'voice replies';

/** One failure renderer for both the gateway-rejection and thrown-error shapes. */
const renderFailure = (input: unknown): string =>
  renderSpec(
    classifyGatewayFailure(input, VOICE_REPLIES_RESOURCE, { failedAction: 'set voice replies' })
  );

/** Narrows to the Voice Response Mode values the subcommand's choices offer (canonical set). */
function isVoiceMode(value: string): value is VoiceResponseMode {
  return (VOICE_RESPONSE_MODES as readonly string[]).includes(value);
}

/** Handle /voice replies */
export async function handleVoiceReplies(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = voiceRepliesOptions(context.interaction);
  const personalityId = options.character();
  const rawMode = options.mode();

  if (isAutocompleteErrorSentinel(personalityId)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }

  // The subcommand's static choices constrain this to the three modes; the
  // guard narrows the generated string accessor without a cast.
  if (!isVoiceMode(rawMode)) {
    logger.warn({ userId, rawMode }, 'Unexpected voice reply mode');
    await context.editReply({
      content: renderSpec(CATALOG.error.validation('Unknown voice reply mode.')),
    });
    return;
  }
  const mode: VoiceResponseMode = rawMode;

  try {
    const { userClient } = clientsFor(context.interaction);

    // The same per-character tier the overrides dashboard writes.
    const writeResult = await userClient.updatePersonalityOverrides(personalityId, {
      voiceResponseMode: mode,
    });

    if (!writeResult.ok) {
      logger.warn(
        { userId, status: writeResult.status, personalityId, mode },
        'Failed to set voice response mode'
      );
      await context.editReply({ content: renderFailure(writeResult) });
      return;
    }

    // Fetch character metadata (name + voiceEnabled) and confirm the cascade
    // read-back matches the just-written user-personality tier, passing
    // skipVoices='true' to skip live provider voice listing. Because cascade
    // cache invalidation travels over async pub/sub, a cached entry can lag
    // and return an older mode or source; a mismatch falls back to
    // committedUnconfirmed (pinned in replies.test.ts). (channelId is null
    // outside a guild/DM context — normalized to undefined so the query param
    // is omitted.)
    const channelId = context.interaction.channelId ?? undefined;
    const resolution = await userClient.getVoiceResolution({
      personalityId,
      channelId,
      skipVoices: 'true',
    });

    if (!resolution.ok) {
      logger.warn(
        { userId, personalityId, status: resolution.status },
        'Set voice response mode; resolution read failed'
      );
      // The write APPLIED; only the confirmation read-back failed — the
      // outcome-honest shape (never invites a duplicate save).
      await context.editReply({
        content: renderSpec(CATALOG.error.committedUnconfirmed(VOICE_REPLIES_RESOURCE)),
      });
      return;
    }

    const { personalityName, voiceEnabled, voiceResponseMode } = resolution.data;

    if (voiceResponseMode.value !== mode || voiceResponseMode.source !== 'user-personality') {
      logger.warn(
        {
          userId,
          personalityId,
          writtenMode: mode,
          readMode: voiceResponseMode.value,
          readSource: voiceResponseMode.source,
        },
        'Set voice response mode; resolution read-back mismatched write'
      );
      await context.editReply({
        content: renderSpec(CATALOG.error.committedUnconfirmed(VOICE_REPLIES_RESOURCE)),
      });
      return;
    }

    const resolvedLine =
      `Voice replies for **${escapeMarkdown(personalityName)}**: ` +
      `**${voiceModeValueLabel(mode)}** _(${voiceModeSourceLabel('user-personality')})_.`;
    const voiceNote = voiceEnabled
      ? undefined
      : "Voice replies also need the character's voice enabled by its creator — `/voice view` shows whether it is.";
    const body = [resolvedLine, voiceNote, 'Use `/voice view` for the full voice settings.']
      .filter((line): line is string => line !== undefined)
      .join('\n\n');

    await context.editReply({
      content: renderSpec(voiceEnabled ? CATALOG.success.done(body) : CATALOG.info.warning(body)),
    });

    logger.info(
      { userId, personalityId, mode, resolvedMode: voiceResponseMode.value },
      'Set voice response mode'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: VOICE_REPLIES_RESOURCE }, 'Error');
    await context.editReply({ content: renderFailure(error) });
  }
}
