/**
 * LLM Config Create Handler
 * Handles /llm-config create subcommand
 */

import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { deferEphemeral, replyWithError, handleCommandError } from '../../utils/commandHelpers.js';

const logger = createLogger('llm-config-create');

interface CreateResponse {
  config: {
    id: string;
    name: string;
    model: string;
    provider: string;
  };
}

/**
 * Handle /llm-config create
 */
export async function handleCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const name = interaction.options.getString('name', true);
  const model = interaction.options.getString('model', true);
  const description = interaction.options.getString('description');
  const provider = interaction.options.getString('provider') ?? 'openrouter';
  const visionModel = interaction.options.getString('vision-model');

  await deferEphemeral(interaction);

  try {
    const result = await callGatewayApi<CreateResponse>('/user/llm-config', {
      method: 'POST',
      userId,
      body: { name, model, description, provider, visionModel },
    });

    if (!result.ok) {
      logger.warn({ userId, status: result.status, name }, '[LlmConfig] Failed to create config');
      await replyWithError(interaction, `Failed to create config: ${result.error}`);
      return;
    }

    const data = result.data;

    const shortModel = data.config.model.includes('/')
      ? data.config.model.split('/').pop()
      : data.config.model;

    const embed = new EmbedBuilder()
      .setTitle('✅ Config Created')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(`Your LLM config **${data.config.name}** has been created.`)
      .addFields(
        { name: 'Provider', value: data.config.provider, inline: true },
        { name: 'Model', value: shortModel ?? data.config.model, inline: true }
      )
      .setFooter({ text: 'Use /model set to apply this config to a personality' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info({ userId, configId: data.config.id, name }, '[LlmConfig] Created config');
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'LlmConfig Create' });
  }
}
