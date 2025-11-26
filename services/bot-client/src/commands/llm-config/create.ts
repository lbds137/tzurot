/**
 * LLM Config Create Handler
 * Handles /llm-config create subcommand
 */

import { EmbedBuilder, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, getConfig, DISCORD_COLORS } from '@tzurot/common-types';

const logger = createLogger('llm-config-create');
const config = getConfig();

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

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const gatewayUrl = config.GATEWAY_URL;
    if (gatewayUrl === undefined || gatewayUrl.length === 0) {
      await interaction.editReply({
        content: '❌ Service configuration error. Please try again later.',
      });
      return;
    }

    const response = await fetch(`${gatewayUrl}/user/llm-config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userId}`,
      },
      body: JSON.stringify({
        name,
        model,
        description,
        provider,
        visionModel,
      }),
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as { error?: string };
      logger.warn({ userId, status: response.status, name }, '[LlmConfig] Failed to create config');
      await interaction.editReply({
        content: `❌ Failed to create config: ${errorData.error ?? 'Unknown error'}`,
      });
      return;
    }

    const data = (await response.json()) as CreateResponse;

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
    logger.error({ err: error, userId }, '[LlmConfig] Error creating config');
    await interaction.editReply({
      content: '❌ An error occurred. Please try again later.',
    });
  }
}
