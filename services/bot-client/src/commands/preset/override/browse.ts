/**
 * Preset Override Browse Handler
 * Handles /preset override browse — lists the user's per-character preset
 * overrides and lets them clear one by selecting it (shared override browser).
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

const logger = createLogger('preset-override-browse');

/**
 * customId prefix — must match preset/index.ts componentPrefixes. Keeps its
 * historical 'settings-preset-override' string so in-flight components from
 * pre-rename messages still route; only the owning command moved.
 */
export const PRESET_OVERRIDE_PREFIX = 'settings-preset-override';

const presetOverrideConfig: OverrideBrowseConfig = {
  prefix: PRESET_OVERRIDE_PREFIX,
  // ⚙️ preset — the rows override which PRESET a character uses; 🎭 is the
  // character entity's glyph (§2.1 one-glyph-per-entity).
  entityEmoji: ENTITY_EMOJI.preset,
  titleNoun: 'Preset Overrides',
  entityType: 'preset override',
  fallbackNoun: 'preset',
  emptyDescription:
    "You haven't set any preset overrides — use `/preset override set` to " +
    'override which preset a character uses.',
  clearCommandHint: '/preset override clear',
  selectPlaceholder: 'Select an override to clear…',
  logger,
  // One all-slots call: the gateway emits a row per non-null FK, each tagged with
  // its slot, so a character with both a text + a vision override surfaces as two
  // rows that badge and clear independently. (`slot` is nullable on the summary to
  // mirror `configId`, but all-slots rows always carry it — coerce null → undefined.)
  list: async userClient => {
    const result = await userClient.listModelOverrides({ slot: 'all' });
    if (!result.ok) {
      logger.warn({ status: result.status }, 'Failed to list preset overrides');
      return null;
    }
    return result.data.overrides.map(o => ({ ...o, slot: o.slot ?? undefined }));
  },
  delete: (userClient, personalityId, slot) =>
    userClient.deleteModelOverride(personalityId, { slot }),
};

const presetOverrideIds = createOverrideBrowseCustomIds(PRESET_OVERRIDE_PREFIX);

/** Whether a customId belongs to the preset-override browser. */
export function isPresetOverrideInteraction(customId: string): boolean {
  return presetOverrideIds.isOwn(customId);
}

/** Handle /preset override browse */
export function handlePresetBrowse(context: DeferredCommandContext): Promise<void> {
  return handleOverrideBrowse(presetOverrideConfig, context);
}

/** Handle preset-override select-menu (select → confirm clear). */
export function handlePresetBrowseSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  return handleOverrideBrowseSelect(presetOverrideConfig, interaction);
}

/** Handle preset-override confirm/cancel buttons. */
export function handlePresetBrowseButton(interaction: ButtonInteraction): Promise<void> {
  return handleOverrideBrowseButton(presetOverrideConfig, interaction);
}
