/**
 * LLM Config Delete Handler
 * Handles /llm-config delete subcommand
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import {
  deferEphemeral,
  replyWithError,
  handleCommandError,
  createSuccessEmbed,
} from '../../utils/commandHelpers.js';

const logger = createLogger('llm-config-delete');

/**
 * Handle /llm-config delete
 */
export async function handleDelete(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const configId = interaction.options.getString('config', true);

  await deferEphemeral(interaction);

  try {
    const result = await callGatewayApi<void>(`/user/llm-config/${configId}`, {
      method: 'DELETE',
      userId,
    });

    if (!result.ok) {
      logger.warn(
        { userId, status: result.status, configId },
        '[LlmConfig] Failed to delete config'
      );
      await replyWithError(interaction, `Failed to delete config: ${result.error}`);
      return;
    }

    const embed = createSuccessEmbed('🗑️ Config Deleted', 'Your LLM config has been deleted.');
    await interaction.editReply({ embeds: [embed] });

    logger.info({ userId, configId }, '[LlmConfig] Deleted config');
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'LlmConfig Delete' });
  }
}
