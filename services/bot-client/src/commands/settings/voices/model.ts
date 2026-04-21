/**
 * Voice Model Selection Handler
 *
 * Allows BYOK users to choose their preferred ElevenLabs TTS model.
 * Saves the preference via the config cascade (user-default tier).
 */

import { EmbedBuilder } from 'discord.js';
import type { AutocompleteInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS, DISCORD_LIMITS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi, GATEWAY_TIMEOUTS, toGatewayUser } from '../../../utils/userGatewayClient.js';

const logger = createLogger('settings-voices-model');

interface ModelEntry {
  modelId: string;
  name: string;
}

interface ModelsListResponse {
  models: ModelEntry[];
}

/**
 * Handle /settings voices model <model>
 * Sets the user's preferred ElevenLabs TTS model via config cascade.
 */
export async function handleModelSet(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const modelId = context.getRequiredOption<string>('model');

  try {
    // Save preference via config cascade (user-default tier)
    const result = await callGatewayApi<Record<string, unknown>>(
      '/user/config-overrides/defaults',
      {
        method: 'PATCH',
        user: toGatewayUser(context.user),
        body: { elevenlabsTtsModel: modelId },
        timeout: GATEWAY_TIMEOUTS.DEFERRED,
      }
    );

    if (!result.ok) {
      await context.editReply({ content: `❌ ${result.error}` });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('🔊 TTS Model Updated')
      .setDescription(`ElevenLabs TTS model set to **\`${modelId}\`**`)
      .setColor(DISCORD_COLORS.SUCCESS)
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, modelId }, 'Set TTS model');
  } catch (error) {
    logger.error({ err: error, userId }, 'Unexpected error');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}

/**
 * Autocomplete handler for ElevenLabs TTS model selection.
 * Fetches available models from the gateway and filters by user input.
 */
export async function handleModelAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const userId = interaction.user.id;
  const focused = interaction.options.getFocused();
  const query = focused.toLowerCase();

  try {
    const result = await callGatewayApi<ModelsListResponse>('/user/voices/models', {
      user: toGatewayUser(interaction.user),
      timeout: GATEWAY_TIMEOUTS.AUTOCOMPLETE,
    });

    if (!result.ok) {
      await interaction.respond([]);
      return;
    }

    const filtered = result.data.models
      .filter(m => m.modelId.toLowerCase().includes(query) || m.name.toLowerCase().includes(query))
      .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

    const choices = filtered.map(m => ({
      name: `${m.name} (${m.modelId})`,
      value: m.modelId,
    }));

    await interaction.respond(choices);
  } catch (error) {
    logger.error({ err: error, userId }, 'Error');
    await interaction.respond([]);
  }
}
