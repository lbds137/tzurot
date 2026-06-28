/**
 * Preset Global Set Default Handler
 * Handles /preset global set-default subcommand
 * Sets a global config as the system default (owner only)
 */

import {
  presetGlobalDefaultOptions,
  toConfigKind,
  DEFAULT_CONFIG_KIND,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { handleGlobalPresetUpdate } from './globalPresetHelpers.js';

/**
 * Handle /preset global set-default
 */
export async function handleGlobalSetDefault(context: DeferredCommandContext): Promise<void> {
  const options = presetGlobalDefaultOptions(context.interaction);
  const configId = options.preset();
  // Admin set-default gates by kind (requireKind); pass it so a vision preset
  // promotes to the vision default. Defaults text → existing usage unchanged.
  const kind = toConfigKind(options.kind() ?? DEFAULT_CONFIG_KIND);

  await handleGlobalPresetUpdate(context, configId, {
    promote: (ownerClient, id) => ownerClient.setGlobalLlmConfigDefault(id, { kind }),
    embedTitle: 'System Default Preset Updated',
    embedDescription: (configName: string) =>
      `**${configName}** is now the system default preset.\n\n` +
      'Characters without a specific config will use this default.',
    logMessage: '[Preset/Global] Set system default preset',
    errorLogMessage: '[Preset/Global] Error setting default',
  });
}
