/**
 * Preset Global Free Default Handler
 * Handles /preset global free-default subcommand
 * Sets a global config as the free tier default for guest users (owner only)
 */

import { EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS, presetGlobalFreeDefaultOptions } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { adminPutJson } from '../../../utils/adminApiClient.js';

const logger = createLogger('preset-global-free-default');

/**
 * Handle /preset global free-default
 */
export async function handleGlobalSetFreeDefault(context: DeferredCommandContext): Promise<void> {
  const options = presetGlobalFreeDefaultOptions(context.interaction);
  const configId = options.config();

  try {
    const response = await adminPutJson(`/admin/llm-config/${configId}/set-free-default`, {});

    if (!response.ok) {
      const errorData = (await response.json()) as { error?: string };
      await context.editReply({ content: `❌ ${errorData.error ?? `HTTP ${response.status}`}` });
      return;
    }

    const data = (await response.json()) as { configName: string };

    const embed = new EmbedBuilder()
      .setTitle('Free Tier Default Preset Updated')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `**${data.configName}** is now the free tier default preset.\n\n` +
          'Guest users without API keys will use this model for AI responses.'
      )
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info(
      { configId, configName: data.configName },
      '[Preset/Global] Set free tier default preset'
    );
  } catch (error) {
    logger.error(
      { err: error, userId: context.user.id },
      '[Preset/Global] Error setting free default'
    );
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
