/**
 * Global Preset Update Helpers
 *
 * Shared logic for /preset global commands that set a config as a default.
 * Both free-default and set-default follow the same pattern:
 * admin PUT → error handling → success embed with configName.
 */

import { EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { adminPutJson } from '../../../utils/adminApiClient.js';

const logger = createLogger('preset-global-helpers');

/** Configuration for a global preset update operation */
export interface GlobalPresetUpdateConfig {
  /** API endpoint path (e.g. '/admin/llm-config/{id}/set-default') */
  apiPath: string;
  /** Title for the success embed */
  embedTitle: string;
  /** Description template — receives configName as parameter */
  embedDescription: (configName: string) => string;
  /** Log message for success */
  logMessage: string;
  /** Log message for error */
  errorLogMessage: string;
}

/**
 * Execute a global preset update: admin PUT → error handling → success embed.
 */
export async function handleGlobalPresetUpdate(
  context: DeferredCommandContext,
  configId: string,
  config: GlobalPresetUpdateConfig
): Promise<void> {
  try {
    const response = await adminPutJson(config.apiPath, {});

    if (!response.ok) {
      const errorData = (await response.json()) as { error?: string };
      await context.editReply({ content: `❌ ${errorData.error ?? `HTTP ${response.status}`}` });
      return;
    }

    const data = (await response.json()) as { configName: string };

    const embed = new EmbedBuilder()
      .setTitle(config.embedTitle)
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(config.embedDescription(data.configName))
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info({ configId, configName: data.configName }, config.logMessage);
  } catch (error) {
    logger.error({ err: error, userId: context.user.id }, config.errorLogMessage);
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
