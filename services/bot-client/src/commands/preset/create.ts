/**
 * Preset Create Handler
 * Handles /preset create subcommand
 */

import { EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';

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
export async function handleCreate(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const name = context.interaction.options.getString('name', true);
  const model = context.interaction.options.getString('model', true);
  const description = context.interaction.options.getString('description');
  const provider = context.interaction.options.getString('provider') ?? 'openrouter';
  const visionModel = context.interaction.options.getString('vision-model');

  try {
    const result = await callGatewayApi<CreateResponse>('/user/llm-config', {
      method: 'POST',
      userId,
      body: { name, model, description, provider, visionModel },
    });

    if (!result.ok) {
      logger.warn({ userId, status: result.status, name }, '[Preset] Failed to create preset');
      await context.editReply({ content: `❌ Failed to create preset: ${result.error}` });
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

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, configId: data.config.id, name }, '[Preset] Created preset');
  } catch (error) {
    logger.error({ err: error, userId }, '[Preset] Error creating preset');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
