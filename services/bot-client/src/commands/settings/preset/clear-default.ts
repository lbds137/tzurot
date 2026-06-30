/**
 * Settings Preset Clear-Default Handler
 * Handles /settings preset clear-default subcommand
 * Clears the user's global default preset
 */

import { EmbedBuilder } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  settingsPresetClearDefaultOptions,
  toConfigKind,
  DEFAULT_CONFIG_KIND,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { clientsFor } from '../../../utils/gatewayClients.js';

const logger = createLogger('settings-preset-clear-default');

/**
 * Handle /settings preset clear-default
 */
export async function handleClearDefault(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  // Which default to clear: Chat (text default) or Vision — the operation is
  // slot-specific (the vision default is a separate FK from the text default).
  const kind = toConfigKind(
    settingsPresetClearDefaultOptions(context.interaction).slot() ?? DEFAULT_CONFIG_KIND
  );

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.clearDefaultModelConfig({ kind });

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, 'Failed to clear default');
      await context.editReply({ content: `❌ Failed to clear default: ${result.error}` });
      return;
    }

    // Tell the user explicitly what they'll get next, instead of generic
    // "use their own defaults" guidance. Per-character overrides are
    // unaffected and surface in the second sentence.
    const fallbackLine =
      result.data.newEffectiveDefault !== null
        ? `Falling back to system default: \`${result.data.newEffectiveDefault.name}\`.`
        : 'No system default is configured; the bot will use its built-in fallback.';

    const embed = new EmbedBuilder()
      .setTitle('✅ Default Preset Cleared')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `Your default preset has been removed.\n\n${fallbackLine}\n\n` +
          'Characters with their own per-character overrides will continue to use those.'
      )
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, kind, newDefault: result.data.newEffectiveDefault?.name ?? null },
      'Cleared default config'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'Preset Clear-Default' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
