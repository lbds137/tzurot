/**
 * Preset Global Free Default Handler
 * Handles /preset global free-default subcommand
 * Sets a global config as the free tier default for guest users (owner only)
 */

import { DEFAULT_CONFIG_KIND } from '@tzurot/common-types/constants/ai';
import { presetGlobalFreeDefaultOptions } from '@tzurot/common-types/generated/commandOptions';
import { toConfigKind } from '@tzurot/common-types/services/LlmConfigMapper';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { handleGlobalPresetUpdate } from './globalPresetHelpers.js';

/**
 * Handle /preset global free-default
 */
export async function handleGlobalSetFreeDefault(context: DeferredCommandContext): Promise<void> {
  const options = presetGlobalFreeDefaultOptions(context.interaction);
  const configId = options.preset();
  const kind = toConfigKind(options.slot() ?? DEFAULT_CONFIG_KIND);

  await handleGlobalPresetUpdate(context, configId, {
    promote: (ownerClient, id) => ownerClient.setGlobalLlmConfigFreeDefault(id, { kind }),
    embedTitle: 'Free Tier Default Preset Updated',
    embedDescription: (configName: string) =>
      `**${configName}** is now the free tier default preset.\n\n` +
      'Guest users without API keys will use this model for AI responses.',
    logMessage: '[Preset/Global] Set free tier default preset',
    errorLogMessage: '[Preset/Global] Error setting free default',
  });
}
