/**
 * Preset Global Set Default Handler
 * Handles /preset global set-default subcommand
 * Sets a global config as the system default (owner only)
 */

import { DEFAULT_MODEL_SLOT, toModelSlot } from '@tzurot/common-types/constants/ai';
import { presetGlobalDefaultOptions } from '@tzurot/common-types/generated/commandOptions';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { handleGlobalPresetUpdate } from './globalPresetHelpers.js';

/**
 * Handle /preset global set-default
 */
export async function handleGlobalSetDefault(context: DeferredCommandContext): Promise<void> {
  const options = presetGlobalDefaultOptions(context.interaction);
  const configId = options.preset();
  // Admin set-default targets a slot; pass it so a vision preset
  // promotes to the vision default. Defaults Chat → existing usage unchanged.
  const slot = toModelSlot(options.slot() ?? DEFAULT_MODEL_SLOT);

  await handleGlobalPresetUpdate(context, configId, {
    promote: (ownerClient, id) => ownerClient.setGlobalLlmConfigDefault(id, { slot }),
    embedTitle: 'System Default Preset Updated',
    embedDescription: (configName: string) =>
      `**${configName}** is now the system default preset.\n\n` +
      'Characters without a specific config will use this default.',
    logMessage: '[Preset/Global] Set system default preset',
    errorLogMessage: '[Preset/Global] Error setting default',
  });
}
