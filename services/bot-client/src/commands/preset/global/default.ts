/**
 * Preset Global Set Default Handler
 * Handles /preset global default subcommand
 * Sets a global config as the system default (owner only)
 */

import { toModelSlotOrBoth, MODEL_SLOT_LABELS } from '@tzurot/common-types/constants/ai';
import { presetGlobalDefaultOptions } from '@tzurot/common-types/generated/commandOptions';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { handleGlobalPresetUpdate } from './globalPresetHelpers.js';

/**
 * Handle /preset global default
 */
export async function handleGlobalSetDefault(context: DeferredCommandContext): Promise<void> {
  const options = presetGlobalDefaultOptions(context.interaction);
  const configId = options.preset();
  // The admin default targets a slot (or the `both` alias writing both pointers
  // in one request); pass it so a vision preset promotes to the vision default.
  // Defaults Chat → existing usage unchanged.
  const slot = toModelSlotOrBoth(options.slot());

  await handleGlobalPresetUpdate(context, configId, {
    promote: (ownerClient, id) => ownerClient.setGlobalLlmConfigDefault(id, { slot }),
    embedTitle: 'System Default Preset Updated',
    embedDescription: (configName: string) =>
      (slot === 'both'
        ? `**${configName}** is now the system default for both ${MODEL_SLOT_LABELS.text} and ${MODEL_SLOT_LABELS.vision}.\n\n`
        : `**${configName}** is now the system default ${MODEL_SLOT_LABELS[slot]} preset.\n\n`) +
      'Characters without a specific config will use this default.',
    logMessage: '[Preset/Global] Set system default preset',
    errorLogMessage: '[Preset/Global] Error setting default',
  });
}
