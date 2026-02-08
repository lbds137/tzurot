/**
 * Preset Global Free Default Handler
 * Handles /preset global free-default subcommand
 * Sets a global config as the free tier default for guest users (owner only)
 */

import { presetGlobalFreeDefaultOptions } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { handleGlobalPresetUpdate } from './globalPresetHelpers.js';

/**
 * Handle /preset global free-default
 */
export async function handleGlobalSetFreeDefault(context: DeferredCommandContext): Promise<void> {
  const options = presetGlobalFreeDefaultOptions(context.interaction);
  const configId = options.config();

  await handleGlobalPresetUpdate(context, configId, {
    apiPath: `/admin/llm-config/${configId}/set-free-default`,
    embedTitle: 'Free Tier Default Preset Updated',
    embedDescription: (configName: string) =>
      `**${configName}** is now the free tier default preset.\n\n` +
      'Guest users without API keys will use this model for AI responses.',
    logMessage: '[Preset/Global] Set free tier default preset',
    errorLogMessage: '[Preset/Global] Error setting free default',
  });
}
