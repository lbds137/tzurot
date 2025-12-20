/**
 * Me Model Set-Default Handler
 * Handles /me model set-default subcommand
 * Sets the user's global default LLM config (applies to all personalities)
 */

import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  isFreeModel,
  type AIProvider,
  type LlmConfigSummary,
} from '@tzurot/common-types';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';
import { replyWithError, handleCommandError } from '../../../utils/commandHelpers.js';
import { UNLOCK_MODELS_VALUE } from './autocomplete.js';

const logger = createLogger('me-model-set-default');

interface SetDefaultResponse {
  default: {
    configId: string;
    configName: string;
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
 * Handle /me model set-default
 */
export async function handleSetDefault(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const configId = interaction.options.getString('config', true);

  // Handle "Unlock All Models" upsell selection
  if (configId === UNLOCK_MODELS_VALUE) {
    const embed = new EmbedBuilder()
      .setTitle('✨ Unlock All Models')
      .setColor(DISCORD_COLORS.BLURPLE)
      .setDescription(
        "You're currently in **Guest Mode**, which only allows free models.\n\n" +
          'To unlock **all 400+ models** including GPT-4, Claude, and more:\n\n' +
          '1. Get an API key from [OpenRouter](https://openrouter.ai/keys)\n' +
          '2. Run `/wallet set` and enter your key\n' +
          "3. That's it! All models will be available."
      )
      .setFooter({ text: 'Your API key is encrypted and stored securely' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    logger.info({ userId }, '[Me/Model] User clicked unlock models upsell');
    return;
  }

  try {
    // Check wallet status and get config details in parallel
    const [walletResult, configsResult] = await Promise.all([
      callGatewayApi<WalletListResponse>('/wallet/list', { userId }),
      callGatewayApi<ConfigListResponse>('/user/llm-config', { userId }),
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
              'Use `/wallet set` to add your own API key for full model access.'
          )
          .setFooter({ text: 'Use /preset list to see available free configs' })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        logger.info(
          { userId, configId, configName: selectedConfig.name, isGuestMode },
          '[Me/Model] Guest mode user tried to set premium model as default'
        );
        return;
      }
    }

    const result = await callGatewayApi<SetDefaultResponse>('/user/model-override/default', {
      method: 'PUT',
      userId,
      body: { configId },
    });

    if (!result.ok) {
      logger.warn({ userId, status: result.status, configId }, '[Me/Model] Failed to set default');
      await replyWithError(interaction, `Failed to set default: ${result.error}`);
      return;
    }

    const data = result.data;

    const embed = new EmbedBuilder()
      .setTitle('✅ Default Config Set')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `Your default LLM config is now **${data.default.configName}**.\n\n` +
          'This will be used for all personalities unless you have a specific override.'
      )
      .setFooter({ text: 'Use /me model clear-default to remove this setting' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      { userId, configId, configName: data.default.configName },
      '[Me/Model] Set default config'
    );
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'Model Set-Default' });
  }
}
