/**
 * Voice TTS Browse Handler
 * Handles /voice tts browse — lists the user's per-character TTS overrides
 * and lets them clear one by selecting it.
 *
 * Mirrors `/preset override browse`; both are built on the shared override
 * browser. Shows the user's overrides, not the underlying TtsConfig catalog
 * (the catalog is reachable through `/voice tts set` autocomplete).
 */

import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { ENTITY_EMOJI } from '@tzurot/common-types/constants/uxVocabulary';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import {
  type OverrideBrowseConfig,
  handleOverrideBrowse,
  handleOverrideBrowseSelect,
  handleOverrideBrowseButton,
  createOverrideBrowseCustomIds,
} from '../../../utils/overrideBrowse.js';

const logger = createLogger('voice-tts-browse');

/** customId prefix — must match voice/index.ts componentPrefixes. */
export const TTS_OVERRIDE_PREFIX = 'voice-tts-override';

const ttsOverrideConfig: OverrideBrowseConfig = {
  prefix: TTS_OVERRIDE_PREFIX,
  // 🎤 is the single voice-entity glyph (§2.1) — 🔊 variants collapse onto it.
  entityEmoji: ENTITY_EMOJI.voice,
  titleNoun: 'TTS Overrides',
  entityType: 'TTS override',
  fallbackNoun: 'TTS config',
  emptyDescription:
    "You haven't set any TTS overrides — use `/voice tts set` to override " +
    'which TTS config a character uses, or `/voice tts set-default` to set ' +
    'your global default.',
  clearCommandHint: '/voice tts clear',
  selectPlaceholder: 'Select an override to clear…',
  logger,
  // TTS overrides have no kind axis — return the rows untagged (the shared
  // browser treats a missing `kind` exactly as before).
  list: async userClient => {
    const result = await userClient.listTtsOverrides();
    if (!result.ok) {
      logger.warn({ status: result.status }, 'Failed to list TTS overrides');
      return null;
    }
    return result.data.overrides;
  },
  delete: (userClient, personalityId) => userClient.deleteTtsOverride(personalityId),
};

const ttsOverrideIds = createOverrideBrowseCustomIds(TTS_OVERRIDE_PREFIX);

/** Whether a customId belongs to the TTS-override browser. */
export function isTtsOverrideInteraction(customId: string): boolean {
  return ttsOverrideIds.isOwn(customId);
}

/** Handle /voice tts browse */
export function handleTtsBrowse(context: DeferredCommandContext): Promise<void> {
  return handleOverrideBrowse(ttsOverrideConfig, context);
}

/** Handle TTS-override select-menu (select → confirm clear). */
export function handleTtsBrowseSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  return handleOverrideBrowseSelect(ttsOverrideConfig, interaction);
}

/** Handle TTS-override confirm/cancel buttons. */
export function handleTtsBrowseButton(interaction: ButtonInteraction): Promise<void> {
  return handleOverrideBrowseButton(ttsOverrideConfig, interaction);
}
