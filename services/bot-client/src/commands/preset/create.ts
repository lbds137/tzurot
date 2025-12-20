/**
 * Preset Create Handler
 * Handles /preset create subcommand
 */

import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { replyWithError, handleCommandError } from '../../utils/commandHelpers.js';

const logger = createLogger('preset-create');

interface CreateResponse {
  config: {
    id: string;
    name: string;
    model: string;
    provider: string;
  };
}

/**
 * Handle /preset create
 */
export async function handleCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const name = interaction.options.getString('name', true);
  const model = interaction.options.getString('model', true);
  const description = interaction.options.getString('description');
  const provider = interaction.options.getString('provider') ?? 'openrouter';
  const visionModel = interaction.options.getString('vision-model');

  try {
    const result = await callGatewayApi<CreateResponse>('/user/llm-config', {
      method: 'POST',
      userId,
      body: { name, model, description, provider, visionModel },
    });

    if (!result.ok) {
      logger.warn({ userId, status: result.status, name }, '[Preset] Failed to create preset');
      await replyWithError(interaction, `Failed to create preset: ${result.error}`);
      return;
    }

    const data = result.data;

    const shortModel = data.config.model.includes('/')
      ? data.config.model.split('/').pop()
      : data.config.model;

    const embed = new EmbedBuilder()
      .setTitle('✅ Preset Created')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(`Your preset **${data.config.name}** has been created.`)
      .addFields(
        { name: 'Provider', value: data.config.provider, inline: true },
        { name: 'Model', value: shortModel ?? data.config.model, inline: true }
      )
      .setFooter({ text: 'Use /model set to apply this preset to a personality' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info({ userId, configId: data.config.id, name }, '[Preset] Created preset');
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'Preset Create' });
  }
}
