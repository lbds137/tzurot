/**
 * Preset Global Create Handler
 * Handles /preset global create subcommand
 * Creates a new global LLM config (owner only)
 */

import { EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { adminPostJson } from '../../../utils/adminApiClient.js';

const logger = createLogger('preset-global-create');

/**
 * Handle /preset global create
 */
export async function handleGlobalCreate(context: DeferredCommandContext): Promise<void> {
  const name = context.interaction.options.getString('name', true);
  const model = context.interaction.options.getString('model', true);
  const provider = context.interaction.options.getString('provider') ?? 'openrouter';
  const description = context.interaction.options.getString('description');
  const visionModel = context.interaction.options.getString('vision-model');

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
      await context.editReply({ content: `❌ ${errorData.error ?? `HTTP ${response.status}`}` });
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

    await context.editReply({ embeds: [embed] });

    logger.info({ name, model }, '[Preset/Global] Created global preset');
  } catch (error) {
    logger.error({ err: error, userId: context.user.id }, '[Preset/Global] Error creating preset');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
