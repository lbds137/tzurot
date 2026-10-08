/**
 * Preset Global Free Default Handler
 * Handles /preset global free-default subcommand
 * Sets a global config as the free tier default for guest users (owner only)
 */

import { toModelSlotOrBoth, MODEL_SLOT_LABELS } from '@tzurot/common-types/constants/ai';
import { presetGlobalFreeDefaultOptions } from '@tzurot/common-types/generated/commandOptions';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { handleGlobalPresetUpdate } from './globalPresetHelpers.js';

/**
 * Handle /preset global free-default
 */
export async function handleGlobalSetFreeDefault(context: DeferredCommandContext): Promise<void> {
  const options = presetGlobalFreeDefaultOptions(context.interaction);
  const configId = options.preset();
  // The `both` alias writes both free pointers in one request; the gateway
  // vision-gates it (and the vision slot) before any write.
  const slot = toModelSlotOrBoth(options.slot());

  await handleGlobalPresetUpdate(context, configId, {
    promote: (ownerClient, id) => ownerClient.setGlobalLlmConfigFreeDefault(id, { slot }),
    embedTitle: 'Free Tier Default Preset Updated',
    embedDescription: (configName: string) =>
      (slot === 'both'
        ? `**${configName}** is now the free tier default for both ${MODEL_SLOT_LABELS.text} and ${MODEL_SLOT_LABELS.vision}.\n\n`
        : `**${configName}** is now the free tier default ${MODEL_SLOT_LABELS[slot]} preset.\n\n`) +
      'Guest users without API keys will use this model for AI responses.',
    logMessage: '[Preset/Global] Set free tier default preset',
    errorLogMessage: '[Preset/Global] Error setting free default',
  });
}
