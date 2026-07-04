/**
 * Global Preset Update Helpers
 *
 * Shared logic for /preset global commands that set a config as a default.
 * Both free-default and set-default follow the same pattern:
 * ownerClient PUT → error handling → success embed with configName.
 */

import { EmbedBuilder } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { type SetDefaultLlmConfigResponse } from '@tzurot/common-types/schemas/api/llm-config';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type GatewayResult, type OwnerClient } from '@tzurot/clients';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { clientsFor } from '../../../utils/gatewayClients.js';

const logger = createLogger('preset-global-helpers');

/** Configuration for a global preset update operation */
export interface GlobalPresetUpdateConfig {
  /**
   * Bound owner-client promotion call. Each caller picks the typed method
   * (`setGlobalLlmConfigDefault` vs `setGlobalLlmConfigFreeDefault`) so the
   * shared helper stays transport-agnostic.
   */
  promote: (
    ownerClient: OwnerClient,
    configId: string
  ) => Promise<GatewayResult<SetDefaultLlmConfigResponse>>;
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
 * Execute a global preset update: ownerClient PUT → error handling → success embed.
 */
export async function handleGlobalPresetUpdate(
  context: DeferredCommandContext,
  configId: string,
  config: GlobalPresetUpdateConfig
): Promise<void> {
  try {
    const { ownerClient } = clientsFor(context.interaction);
    const result = await config.promote(ownerClient, configId);

    if (!result.ok) {
      await context.editReply({ content: `❌ ${result.error}` });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(config.embedTitle)
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(config.embedDescription(result.data.configName))
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info({ configId, configName: result.data.configName }, config.logMessage);
  } catch (error) {
    logger.error({ err: error, userId: context.user.id }, config.errorLogMessage);
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
