/**
 * Voice Delete Handler
 * Deletes a single ElevenLabs cloned voice with autocomplete
 */

import { EmbedBuilder } from 'discord.js';
import type { AutocompleteInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS, DISCORD_LIMITS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi, GATEWAY_TIMEOUTS, toGatewayUser } from '../../../utils/userGatewayClient.js';
import type { VoicesListResponse } from './types.js';
import { getCachedVoices, setCachedVoices, invalidateVoiceCache } from './voiceCache.js';

const logger = createLogger('settings-voices-delete');

interface VoiceDeleteResponse {
  deleted: boolean;
  voiceId: string;
  name: string;
  slug: string;
}

/**
 * Handle /settings voices delete <voice>
 * Deletes a single tzurot-prefixed voice from ElevenLabs
 */
export async function handleDeleteVoice(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const voiceId = context.getRequiredOption<string>('voice');

  try {
    const result = await callGatewayApi<VoiceDeleteResponse>(
      `/user/voices/${encodeURIComponent(voiceId)}`,
      {
        method: 'DELETE',
        user: toGatewayUser(context.user),
        timeout: GATEWAY_TIMEOUTS.DEFERRED,
      }
    );

    if (!result.ok) {
      await context.editReply({ content: `❌ ${result.error}` });
      return;
    }

    // Invalidate cached voice list so autocomplete reflects the deletion
    invalidateVoiceCache(userId);

    const embed = new EmbedBuilder()
      .setTitle('🗑️ Voice Deleted')
      .setDescription(`Removed cloned voice **${result.data.slug}** (\`${result.data.voiceId}\`)`)
      .setColor(DISCORD_COLORS.SUCCESS)
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, voiceId, slug: result.data.slug }, '[Voices Delete] Deleted voice');
  } catch (error) {
    logger.error({ err: error, userId }, '[Voices Delete] Unexpected error');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}

/**
 * Autocomplete handler for voice selection
 * Fetches voice list from gateway and filters by user input
 */
export async function handleVoiceAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const userId = interaction.user.id;
  const focused = interaction.options.getFocused();
  const query = focused.toLowerCase();

  try {
    let voices = getCachedVoices(userId);

    if (voices === null) {
      const result = await callGatewayApi<VoicesListResponse>('/user/voices', {
        user: toGatewayUser(interaction.user),
        timeout: GATEWAY_TIMEOUTS.AUTOCOMPLETE,
      });

      if (!result.ok) {
        await interaction.respond([]);
        return;
      }

      voices = result.data.voices;
      setCachedVoices(userId, voices);
    }

    const filtered = voices
      .filter(v => v.slug.toLowerCase().includes(query) || v.voiceId.toLowerCase().includes(query))
      .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

    const choices = filtered.map(v => ({
      name: v.slug,
      value: v.voiceId,
    }));

    await interaction.respond(choices);
  } catch (error) {
    logger.error({ err: error, userId }, '[Voices Autocomplete] Error');
    await interaction.respond([]);
  }
}
