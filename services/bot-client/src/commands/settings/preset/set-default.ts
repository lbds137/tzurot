/**
 * Settings Preset Set-Default Handler
 * Handles /settings preset set-default subcommand
 * Sets the user's global default preset (applies to all characters)
 */

import { EmbedBuilder } from 'discord.js';
import { DEFAULT_CONFIG_KIND } from '@tzurot/common-types/constants/ai';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { settingsPresetSetDefaultOptions } from '@tzurot/common-types/generated/commandOptions';
import { toConfigKind } from '@tzurot/common-types/services/LlmConfigMapper';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { handleUnlockModelsUpsell, checkGuestModePremiumAccess } from './guestModeValidation.js';

const logger = createLogger('settings-preset-set-default');

/**
 * Handle /settings preset set-default
 */
export async function handleSetDefault(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = settingsPresetSetDefaultOptions(context.interaction);
  const configId = options.preset();
  // The slot (text = chat default, or vision) decides which default FK the value
  // writes; the gateway capability-gates the vision slot. Without sending it a
  // vision default silently lands in the text slot — mirror clear-default.
  const kind = toConfigKind(options.slot() ?? DEFAULT_CONFIG_KIND);

  if (await handleUnlockModelsUpsell(context, configId, userId)) {
    return;
  }

  try {
    const { userClient } = clientsFor(context.interaction);
    const outcome = await checkGuestModePremiumAccess(context, configId, userClient);
    if (outcome.blocked) {
      return;
    }
    const { reason } = outcome;

    const result = await userClient.setDefaultModelConfig({ configId }, { kind });

    if (!result.ok) {
      logger.warn({ userId, status: result.status, configId, kind }, 'Failed to set default');
      await context.editReply({ content: `❌ Failed to set default: ${result.error}` });
      return;
    }

    const data = result.data;

    const embed = new EmbedBuilder()
      .setTitle('✅ Default Preset Set')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `Your default ${kind === 'vision' ? 'vision (image)' : 'chat'} preset is now ` +
          `**${data.default.configName}**.\n\n` +
          'This will be used for all characters unless you have a specific override.'
      )
      .setFooter({ text: 'Use /settings preset clear-default to remove this setting' })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, configId, configName: data.default.configName, kind, reason },
      'Set default config'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'Preset Set-Default' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
