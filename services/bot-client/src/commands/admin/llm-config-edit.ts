/**
 * Admin LLM Config Edit Handler
 * Handles /admin llm-config-edit subcommand
 * Edits an existing global LLM config
 */

import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { deferEphemeral, replyWithError, handleCommandError } from '../../utils/commandHelpers.js';
import { adminPutJson } from '../../utils/adminApiClient.js';

const logger = createLogger('admin-llm-config-edit');

/**
 * Handle /admin llm-config-edit
 */
export async function handleLlmConfigEdit(interaction: ChatInputCommandInteraction): Promise<void> {
  const configId = interaction.options.getString('config', true);
  const name = interaction.options.getString('name');
  const model = interaction.options.getString('model');
  const provider = interaction.options.getString('provider');
  const description = interaction.options.getString('description');
  const visionModel = interaction.options.getString('vision-model');

  await deferEphemeral(interaction);

  try {
    // Build update body (only include provided fields)
    const updateBody: Record<string, unknown> = {};
    if (name !== null) {
      updateBody.name = name;
    }
    if (model !== null) {
      updateBody.model = model;
    }
    if (provider !== null) {
      updateBody.provider = provider;
    }
    if (description !== null) {
      updateBody.description = description;
    }
    if (visionModel !== null) {
      updateBody.visionModel = visionModel;
    }

    if (Object.keys(updateBody).length === 0) {
      await replyWithError(interaction, 'No fields to update. Provide at least one option.');
      return;
    }

    const response = await adminPutJson(`/admin/llm-config/${configId}`, updateBody);

    if (!response.ok) {
      const errorData = (await response.json()) as { error?: string };
      await replyWithError(interaction, errorData.error ?? `HTTP ${response.status}`);
      return;
    }

    const data = (await response.json()) as {
      config: { id: string; name: string; model: string };
    };

    const updatedFields = Object.keys(updateBody).join(', ');

    const embed = new EmbedBuilder()
      .setTitle('Global LLM Config Updated')
      .setColor(DISCORD_COLORS.SUCCESS)
      .addFields(
        { name: 'Name', value: data.config.name, inline: true },
        { name: 'Model', value: data.config.model, inline: true },
        { name: 'Updated Fields', value: updatedFields, inline: false }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info({ configId, updates: updatedFields }, '[Admin] Updated global LLM config');
  } catch (error) {
    await handleCommandError(interaction, error, {
      userId: interaction.user.id,
      command: 'Admin LLM Config Edit',
    });
  }
}
