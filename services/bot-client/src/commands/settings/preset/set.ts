/**
 * Me Preset Set Handler
 * Handles /me preset set subcommand
 */

import { EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS, settingsPresetSetOptions } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';
import { handleUnlockModelsUpsell, checkGuestModePremiumAccess } from './guestModeValidation.js';

const logger = createLogger('settings-preset-set');

interface SetResponse {
  override: {
    personalityId: string;
    personalityName: string;
    configId: string | null;
    configName: string | null;
  };
}

/**
 * Handle /me preset set
 */
export async function handleSet(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = settingsPresetSetOptions(context.interaction);
  const personalityId = options.personality();
  const configId = options.preset();

  if (await handleUnlockModelsUpsell(context, configId, userId)) {
    return;
  }

  try {
    const { isGuestMode, blocked } = await checkGuestModePremiumAccess(context, configId, userId);
    if (blocked) {
      return;
    }

    const result = await callGatewayApi<SetResponse>('/user/model-override', {
      method: 'PUT',
      userId,
      body: { personalityId, configId },
    });

    if (!result.ok) {
      logger.warn(
        { userId, status: result.status, personalityId, configId },
        '[Me/Preset] Failed to set override'
      );
      await context.editReply({ content: `❌ Failed to set preset: ${result.error}` });
      return;
    }

    const data = result.data;

    const embed = new EmbedBuilder()
      .setTitle('✅ Preset Override Set')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `**${data.override.personalityName}** will now use the **${data.override.configName}** preset.`
      )
      .setFooter({ text: 'Use /settings preset reset to remove this override' })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info(
      {
        userId,
        personalityId,
        personalityName: data.override.personalityName,
        configId,
        configName: data.override.configName,
        isGuestMode,
      },
      '[Me/Preset] Set override'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'Preset Set' }, '[Preset Set] Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
