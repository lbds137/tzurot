/**
 * Preset List Handler
 * Handles /preset list subcommand
 */

import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  isFreeModel,
  type LlmConfigSummary,
  type AIProvider,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';

const logger = createLogger('preset-list');

interface ListResponse {
  configs: LlmConfigSummary[];
}

interface WalletListResponse {
  keys: {
    provider: AIProvider;
    isActive: boolean;
  }[];
}

/**
 * Handle /preset list
 */
export async function handleList(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    // Fetch presets and wallet status in parallel
    const [presetResult, walletResult] = await Promise.all([
      callGatewayApi<ListResponse>('/user/llm-config', { userId }),
      callGatewayApi<WalletListResponse>('/wallet/list', { userId }),
    ]);

    if (!presetResult.ok) {
      logger.warn({ userId, status: presetResult.status }, '[Preset] Failed to list presets');
      await context.editReply({ content: '❌ Failed to get presets. Please try again later.' });
      return;
    }

    const data = presetResult.data;

    // Check if user is in guest mode (no active wallet keys)
    const isGuestMode = !(walletResult.ok && walletResult.data.keys.some(k => k.isActive === true));

    const embed = new EmbedBuilder()
      .setTitle('🔧 Model Presets')
      .setColor(isGuestMode ? DISCORD_COLORS.WARNING : DISCORD_COLORS.BLURPLE)
      .setTimestamp();

    // Add guest mode warning if applicable
    if (isGuestMode) {
      embed.setDescription(
        '⚠️ **Guest Mode Active**\n' +
          "You don't have an API key configured, so you're limited to **free models** (marked with 🆓).\n\n" +
          'Use `/wallet set` to add your own API key for full model access.'
      );
    }

    // Separate global and user presets
    const globalPresets = data.configs.filter(c => c.isGlobal);
    const userPresets = data.configs.filter(c => c.isOwned);

    // Helper to format preset with badges
    const formatPreset = (c: LlmConfigSummary): string => {
      const defaultBadge = c.isDefault ? ' ⭐' : '';
      const freeBadge = isFreeModel(c.model) ? ' 🆓' : '';
      const shortModel = c.model.includes('/') ? c.model.split('/').pop() : c.model;
      const safeName = escapeMarkdown(c.name);
      // In guest mode, dim paid presets
      const nameStyle =
        isGuestMode && !isFreeModel(c.model) ? `~~${safeName}~~` : `**${safeName}**`;
      return `${nameStyle}${defaultBadge}${freeBadge}\n└ ${shortModel}`;
    };

    if (globalPresets.length > 0) {
      const lines = globalPresets.map(formatPreset);
      embed.addFields({
        name: '🌐 Global Presets',
        value: lines.join('\n\n'),
        inline: false,
      });
    }

    if (userPresets.length > 0) {
      const lines = userPresets.map(formatPreset);
      embed.addFields({
        name: '👤 Your Presets',
        value: lines.join('\n\n'),
        inline: false,
      });
    }

    if (data.configs.length === 0) {
      const description = isGuestMode
        ? embed.data.description + '\n\nNo presets available.'
        : 'No presets available.\n\nUse `/preset create` to create your own!';
      embed.setDescription(description);
    } else {
      const freeCount = data.configs.filter(c => isFreeModel(c.model)).length;
      embed.setFooter({
        text: isGuestMode
          ? `${freeCount} free presets available • 🆓 = free model`
          : `${globalPresets.length} global, ${userPresets.length} personal presets`,
      });
    }

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, count: data.configs.length, isGuestMode }, '[Preset] Listed presets');
  } catch (error) {
    logger.error({ err: error, userId }, '[Preset] Error listing presets');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
