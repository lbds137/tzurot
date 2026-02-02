/**
 * Me Preset Set Handler
 * Handles /me preset set subcommand
 */

import { EmbedBuilder } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  isFreeModel,
  settingsPresetSetOptions,
  type AIProvider,
  type LlmConfigSummary,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi, GATEWAY_TIMEOUTS } from '../../../utils/userGatewayClient.js';
import { UNLOCK_MODELS_VALUE } from './autocomplete.js';

const logger = createLogger('settings-preset-set');

interface SetResponse {
  override: {
    personalityId: string;
    personalityName: string;
    configId: string | null;
    configName: string | null;
  };
}

interface WalletListResponse {
  keys: {
    provider: AIProvider;
    isActive: boolean;
  }[];
}

interface ConfigListResponse {
  configs: LlmConfigSummary[];
}

/**
 * Handle /me preset set
 */
export async function handleSet(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = settingsPresetSetOptions(context.interaction);
  const personalityId = options.personality();
  const configId = options.preset();

  // Handle "Unlock All Models" upsell selection
  if (configId === UNLOCK_MODELS_VALUE) {
    const embed = new EmbedBuilder()
      .setTitle('✨ Unlock All Models')
      .setColor(DISCORD_COLORS.BLURPLE)
      .setDescription(
        "You're currently in **Guest Mode**, which only allows free models.\n\n" +
          'To unlock **all 400+ models** including GPT-4, Claude, and more:\n\n' +
          '1. Get an API key from [OpenRouter](https://openrouter.ai/keys)\n' +
          '2. Run `/settings apikey set` and enter your key\n' +
          "3. That's it! All models will be available."
      )
      .setFooter({ text: 'Your API key is encrypted and stored securely' })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });
    logger.info({ userId }, '[Me/Preset] User clicked unlock models upsell');
    return;
  }

  try {
    // Check wallet status and get config details in parallel
    // Use longer timeout since this is a deferred operation
    const [walletResult, configsResult] = await Promise.all([
      callGatewayApi<WalletListResponse>('/wallet/list', { userId, timeout: GATEWAY_TIMEOUTS.DEFERRED }),
      callGatewayApi<ConfigListResponse>('/user/llm-config', { userId, timeout: GATEWAY_TIMEOUTS.DEFERRED }),
    ]);

    // Check if user is in guest mode (no active wallet keys)
    const hasActiveWallet =
      walletResult.ok && walletResult.data.keys.some(k => k.isActive === true);
    const isGuestMode = !hasActiveWallet;

    // If guest mode, validate the selected config uses a free model
    if (isGuestMode && configsResult.ok) {
      const selectedConfig = configsResult.data.configs.find(c => c.id === configId);
      if (selectedConfig && !isFreeModel(selectedConfig.model)) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Premium Model Not Available')
          .setColor(DISCORD_COLORS.ERROR)
          .setDescription(
            `**${selectedConfig.name}** uses a premium model that requires an API key.\n\n` +
              'In **Guest Mode**, you can only use configs with free models (marked with 🆓).\n\n' +
              'Use `/settings apikey set` to add your own API key for full model access.'
          )
          .setFooter({ text: 'Use /settings preset browse to see available free presets' })
          .setTimestamp();

        await context.editReply({ embeds: [embed] });
        logger.info(
          { userId, configId, configName: selectedConfig.name, isGuestMode },
          '[Me/Preset] Guest mode user tried to set premium model'
        );
        return;
      }
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
