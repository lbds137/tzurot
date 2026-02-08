/**
 * Preset Global Set Default Handler
 * Handles /preset global set-default subcommand
 * Sets a global config as the system default (owner only)
 */

import { presetGlobalDefaultOptions } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { handleGlobalPresetUpdate } from './globalPresetHelpers.js';

/**
 * Handle /preset global set-default
 */
export async function handleGlobalSetDefault(context: DeferredCommandContext): Promise<void> {
  const options = presetGlobalDefaultOptions(context.interaction);
  const configId = options.config();

  await handleGlobalPresetUpdate(context, configId, {
    apiPath: `/admin/llm-config/${configId}/set-default`,
    embedTitle: 'System Default Preset Updated',
    embedDescription: (configName: string) =>
      `**${configName}** is now the system default preset.\n\n` +
      'Personalities without a specific config will use this default.',
    logMessage: '[Preset/Global] Set system default preset',
    errorLogMessage: '[Preset/Global] Error setting default',
  });
}
