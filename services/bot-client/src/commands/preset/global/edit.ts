/**
 * Preset Global Edit Handler
 * Handles /preset global edit subcommand
 * Edits an existing global LLM config (owner only)
 */

import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { replyWithError, handleCommandError } from '../../../utils/commandHelpers.js';
import { adminPutJson } from '../../../utils/adminApiClient.js';

const logger = createLogger('preset-global-edit');

interface EditOptions {
  name: string | null;
  model: string | null;
  provider: string | null;
  description: string | null;
  visionModel: string | null;
}

/**
 * Build update body from provided options (only non-null fields)
 */
function buildUpdateBody(options: EditOptions): Record<string, string> {
  const body: Record<string, string> = {};
  if (options.name !== null) {
    body.name = options.name;
  }
  if (options.model !== null) {
    body.model = options.model;
  }
  if (options.provider !== null) {
    body.provider = options.provider;
  }
  if (options.description !== null) {
    body.description = options.description;
  }
  if (options.visionModel !== null) {
    body.visionModel = options.visionModel;
  }
  return body;
}

/**
 * Handle /preset global edit
 */
export async function handleGlobalEdit(interaction: ChatInputCommandInteraction): Promise<void> {
  const configId = interaction.options.getString('config', true);

  const updateBody = buildUpdateBody({
    name: interaction.options.getString('name'),
    model: interaction.options.getString('model'),
    provider: interaction.options.getString('provider'),
    description: interaction.options.getString('description'),
    visionModel: interaction.options.getString('vision-model'),
  });

  if (Object.keys(updateBody).length === 0) {
    await replyWithError(interaction, 'No fields to update. Provide at least one option.');
    return;
  }

  try {
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
      .setTitle('Global Preset Updated')
      .setColor(DISCORD_COLORS.SUCCESS)
      .addFields(
        { name: 'Name', value: data.config.name, inline: true },
        { name: 'Model', value: data.config.model, inline: true },
        { name: 'Updated Fields', value: updatedFields, inline: false }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info({ configId, updates: updatedFields }, '[Preset/Global] Updated global preset');
  } catch (error) {
    await handleCommandError(interaction, error, {
      userId: interaction.user.id,
      command: 'Preset Global Edit',
    });
  }
}
