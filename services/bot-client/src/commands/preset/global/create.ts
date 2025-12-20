/**
 * Preset Global Create Handler
 * Handles /preset global create subcommand
 * Creates a new global LLM config (owner only)
 */

import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { replyWithError, handleCommandError } from '../../../utils/commandHelpers.js';
import { adminPostJson } from '../../../utils/adminApiClient.js';

const logger = createLogger('preset-global-create');

/**
 * Handle /preset global create
 */
export async function handleGlobalCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  const name = interaction.options.getString('name', true);
  const model = interaction.options.getString('model', true);
  const provider = interaction.options.getString('provider') ?? 'openrouter';
  const description = interaction.options.getString('description');
  const visionModel = interaction.options.getString('vision-model');

  try {
    const response = await adminPostJson('/admin/llm-config', {
      name,
      model,
      provider,
      description,
      visionModel,
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
      .setTitle('Global Preset Created')
      .setColor(DISCORD_COLORS.SUCCESS)
      .addFields(
        { name: 'Name', value: data.config.name, inline: true },
        { name: 'Model', value: data.config.model, inline: true },
        { name: 'ID', value: `\`${data.config.id}\``, inline: false }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info({ name, model }, '[Preset/Global] Created global preset');
  } catch (error) {
    await handleCommandError(interaction, error, {
      userId: interaction.user.id,
      command: 'Preset Global Create',
    });
  }
}
