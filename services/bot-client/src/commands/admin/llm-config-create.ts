/**
 * Admin LLM Config Create Handler
 * Handles /admin llm-config-create subcommand
 * Creates a new global LLM config
 */

import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS, type EnvConfig } from '@tzurot/common-types';
import { deferEphemeral, replyWithError, handleCommandError } from '../../utils/commandHelpers.js';

const logger = createLogger('admin-llm-config-create');

/**
 * Handle /admin llm-config-create
 */
export async function handleLlmConfigCreate(
  interaction: ChatInputCommandInteraction,
  config: EnvConfig
): Promise<void> {
  const name = interaction.options.getString('name', true);
  const model = interaction.options.getString('model', true);
  const provider = interaction.options.getString('provider') ?? 'openrouter';
  const description = interaction.options.getString('description');
  const visionModel = interaction.options.getString('vision-model');

  await deferEphemeral(interaction);

  try {
    const gatewayUrl = config.GATEWAY_URL;
    if (!gatewayUrl) {
      await replyWithError(interaction, 'Gateway URL not configured');
      return;
    }

    const response = await fetch(`${gatewayUrl}/admin/llm-config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': config.ADMIN_API_KEY ?? '',
      },
      body: JSON.stringify({
        name,
        model,
        provider,
        description,
        visionModel,
      }),
    });

    if (!response.ok) {
      const errorData = (await response.json()) as { error?: string };
      await replyWithError(interaction, errorData.error ?? `HTTP ${response.status}`);
      return;
    }

    const data = (await response.json()) as {
      config: { id: string; name: string; model: string };
    };

    const embed = new EmbedBuilder()
      .setTitle('Global LLM Config Created')
      .setColor(DISCORD_COLORS.SUCCESS)
      .addFields(
        { name: 'Name', value: data.config.name, inline: true },
        { name: 'Model', value: data.config.model, inline: true },
        { name: 'ID', value: `\`${data.config.id}\``, inline: false }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info({ name, model }, '[Admin] Created global LLM config');
  } catch (error) {
    await handleCommandError(interaction, error, {
      userId: interaction.user.id,
      command: 'Admin LLM Config Create',
    });
  }
}
