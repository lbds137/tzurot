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
import {
  callGatewayApi,
  GATEWAY_TIMEOUTS,
  type GatewayUser,
} from '../../../utils/userGatewayClient.js';
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

/**
 * Outcome of the guest-mode premium-model pre-flight check.
 *
 * `reason` distinguishes the four reachable outcomes so callers and
 * observability can tell them apart. Only `guest-premium` causes
 * `blocked: true`; the `check-failed` reason explicitly falls through
 * (fail-open) because the ai-worker's `ApiKeyResolver` + `AuthStep`
 * enforce the gate authoritatively at generation time. Blocking here
 * on a transient `/wallet/list` failure would falsely lock out users
 * who genuinely have active paid keys.
 */
export type GuestModeCheckOutcome =
  | { blocked: false; reason: 'paid' | 'guest-free-model' | 'check-failed' }
  | { blocked: true; reason: 'guest-premium' };

/**
 * Check if a guest mode user is trying to select a premium model config.
 * If so, shows an error embed and returns `blocked: true`.
 *
 * On wallet-API failure, fails OPEN (returns `blocked: false` with reason
 * `check-failed`) and logs a warn. Downstream `ai-worker` enforcement
 * catches the truly-guest case at generation time.
 */
export async function checkGuestModePremiumAccess(
  context: DeferredCommandContext,
  configId: string,
  user: GatewayUser
): Promise<GuestModeCheckOutcome> {
  const [walletResult, configsResult] = await Promise.all([
    callGatewayApi<WalletListResponse>('/wallet/list', {
      user,
      timeout: GATEWAY_TIMEOUTS.DEFERRED,
    }),
    callGatewayApi<ConfigListResponse>('/user/llm-config', {
      user,
      timeout: GATEWAY_TIMEOUTS.DEFERRED,
    }),
  ]);

  if (!walletResult.ok) {
    logger.warn(
      { userId: user.discordId, configId, error: walletResult.error },
      '[Me/Preset] Wallet check failed — failing open, ai-worker will enforce'
    );
    return { blocked: false, reason: 'check-failed' };
  }

  const hasActiveWallet = walletResult.data.keys.some(k => k.isActive === true);

  if (hasActiveWallet) {
    return { blocked: false, reason: 'paid' };
  }

  // Guest mode path: we need the config list to decide whether the selected
  // config is free or premium. A transient configs-endpoint failure leaves us
  // unable to decide — fail-open with an accurate `check-failed` reason
  // rather than mislabeling the outcome as `guest-free-model`.
  if (!configsResult.ok) {
    logger.warn(
      { userId: user.discordId, configId, error: configsResult.error },
      '[Me/Preset] Config list check failed — failing open, ai-worker will enforce'
    );
    return { blocked: false, reason: 'check-failed' };
  }

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
      { userId: user.discordId, configId, configName: selectedConfig.name },
      '[Me/Preset] Guest mode user tried to select premium model'
    );
    return { blocked: true, reason: 'guest-premium' };
  }

  return { blocked: false, reason: 'guest-free-model' };
}
