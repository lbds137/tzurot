/**
 * Preset Global Free Default Handler
 * Handles /preset global free-default subcommand
 * Sets a global config as the free tier default for guest users (owner only)
 */

import { DEFAULT_MODEL_SLOT, toModelSlot } from '@tzurot/common-types/constants/ai';
import { presetGlobalFreeDefaultOptions } from '@tzurot/common-types/generated/commandOptions';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { handleGlobalPresetUpdate } from './globalPresetHelpers.js';

/**
 * Handle /preset global free-default
 */
export async function handleGlobalSetFreeDefault(context: DeferredCommandContext): Promise<void> {
  const options = presetGlobalFreeDefaultOptions(context.interaction);
  const configId = options.preset();
  const slot = toModelSlot(options.slot() ?? DEFAULT_MODEL_SLOT);

  await handleGlobalPresetUpdate(context, configId, {
    promote: (ownerClient, id) => ownerClient.setGlobalLlmConfigFreeDefault(id, { slot }),
    embedTitle: 'Free Tier Default Preset Updated',
    embedDescription: (configName: string) =>
      `**${configName}** is now the free tier default preset.\n\n` +
      'Guest users without API keys will use this model for AI responses.',
    logMessage: '[Preset/Global] Set free tier default preset',
    errorLogMessage: '[Preset/Global] Error setting free default',
  });
}
