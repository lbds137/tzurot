/**
 * Settings Preset Default Handler
 * Handles /settings preset default subcommand
 * Sets the user's global default preset (applies to all personalities)
 */

import { EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS, settingsPresetDefaultOptions } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';
import { handleUnlockModelsUpsell, checkGuestModePremiumAccess } from './guestModeValidation.js';

const logger = createLogger('settings-preset-default');

interface SetDefaultResponse {
  default: {
    configId: string;
    configName: string;
  };
}

/**
 * Handle /settings preset default
 */
export async function handleDefault(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = settingsPresetDefaultOptions(context.interaction);
  const configId = options.preset();

  if (await handleUnlockModelsUpsell(context, configId, userId)) {
    return;
  }

  try {
    const { blocked } = await checkGuestModePremiumAccess(context, configId, userId);
    if (blocked) {
      return;
    }

    const result = await callGatewayApi<SetDefaultResponse>('/user/model-override/default', {
      method: 'PUT',
      userId,
      body: { configId },
    });

    if (!result.ok) {
      logger.warn({ userId, status: result.status, configId }, '[Me/Preset] Failed to set default');
      await context.editReply({ content: `❌ Failed to set default: ${result.error}` });
      return;
    }

    const data = result.data;

    const embed = new EmbedBuilder()
      .setTitle('✅ Default Preset Set')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `Your default preset is now **${data.default.configName}**.\n\n` +
          'This will be used for all personalities unless you have a specific override.'
      )
      .setFooter({ text: 'Use /settings preset clear-default to remove this setting' })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, configId, configName: data.default.configName },
      '[Me/Preset] Set default config'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'Preset Default' }, '[Preset Default] Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
