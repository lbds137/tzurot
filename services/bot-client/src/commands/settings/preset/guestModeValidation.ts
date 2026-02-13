/**
 * Guest Mode Validation Helpers
 *
 * Shared logic for validating guest mode users' access to premium models
 * and showing the "Unlock All Models" upsell embed.
 * Used by both /settings preset default and /settings preset set handlers.
 */

import { EmbedBuilder } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  isFreeModel,
  type AIProvider,
  type LlmConfigSummary,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi, GATEWAY_TIMEOUTS } from '../../../utils/userGatewayClient.js';
import { UNLOCK_MODELS_VALUE } from './autocomplete.js';

const logger = createLogger('settings-preset-guest-mode');

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
 * Show the "Unlock All Models" upsell embed when a guest user selects the upsell option.
 * Returns true if the upsell was shown (caller should return early).
 */
export async function handleUnlockModelsUpsell(
  context: DeferredCommandContext,
  configId: string,
  userId: string
): Promise<boolean> {
  if (configId !== UNLOCK_MODELS_VALUE) {
    return false;
  }

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
  return true;
}

/** Result of guest mode premium model check */
export interface GuestModeCheckResult {
  /** Whether the user is in guest mode (no active wallet keys) */
  isGuestMode: boolean;
}

/**
 * Check if a guest mode user is trying to select a premium model config.
 * If so, shows an error embed and returns true (caller should return early).
 *
 * Also returns isGuestMode for logging purposes.
 */
export async function checkGuestModePremiumAccess(
  context: DeferredCommandContext,
  configId: string,
  userId: string
): Promise<GuestModeCheckResult & { blocked: boolean }> {
  const [walletResult, configsResult] = await Promise.all([
    callGatewayApi<WalletListResponse>('/wallet/list', {
      userId,
      timeout: GATEWAY_TIMEOUTS.DEFERRED,
    }),
    callGatewayApi<ConfigListResponse>('/user/llm-config', {
      userId,
      timeout: GATEWAY_TIMEOUTS.DEFERRED,
    }),
  ]);

  const hasActiveWallet = walletResult.ok && walletResult.data.keys.some(k => k.isActive === true);
  const isGuestMode = !hasActiveWallet;

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
        '[Me/Preset] Guest mode user tried to select premium model'
      );
      return { isGuestMode, blocked: true };
    }
  }

  return { isGuestMode, blocked: false };
}
