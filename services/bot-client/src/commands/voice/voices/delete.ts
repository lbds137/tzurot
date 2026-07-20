/**
 * Voice Delete Handler
 * Deletes a single cloned voice (ElevenLabs or Mistral) with autocomplete.
 *
 * Autocomplete encodes `${provider}:${voiceId}` as the option value so
 * the delete handler knows which provider's API to talk to without an
 * extra round-trip. Gateway accepts `DELETE /user/voices/:provider/:voiceId`.
 */

import { EmbedBuilder, type AutocompleteInteraction } from 'discord.js';
import { CATALOG } from '../../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../../ux/catalog/classify.js';
import { renderSpec } from '../../../ux/render/render.js';
import { DISCORD_COLORS, DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { formatAutocompleteOption } from '@tzurot/common-types/utils/autocompleteFormat';
import { isAudioProviderId, type AudioProviderId } from '@tzurot/common-types/types/audio-provider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { getCachedVoices, setCachedVoices, invalidateVoiceCache } from './voiceCache.js';

const logger = createLogger('voice-voices-delete');

/** Parse the autocomplete value (`${provider}:${voiceId}`) into its parts.
 *  Returns null if the format is unexpected — caller surfaces an error.
 *  Uses `isAudioProviderId` from common-types so the runtime check stays
 *  synchronized with the type definition. */
function parseVoiceOption(value: string): { provider: AudioProviderId; voiceId: string } | null {
  const colonIdx = value.indexOf(':');
  if (colonIdx <= 0) {
    return null;
  }
  const provider = value.slice(0, colonIdx);
  const voiceId = value.slice(colonIdx + 1);
  if (!isAudioProviderId(provider) || voiceId.length === 0) {
    return null;
  }
  return { provider, voiceId };
}

/**
 * Handle /voice voices delete <voice>
 * Deletes a single tzurot-prefixed voice from whichever provider it lives in.
 */
export async function handleDeleteVoice(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const optionValue = context.getRequiredOption<string>('voice');

  const parsed = parseVoiceOption(optionValue);
  if (parsed === null) {
    await context.editReply({
      content: renderSpec(
        CATALOG.error.validation(
          'Invalid voice selection. Please re-run the command and pick a voice from the autocomplete list.'
        )
      ),
    });
    return;
  }

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.deleteVoice(parsed.provider, parsed.voiceId);

    if (!result.ok) {
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(result, 'voice', { failedAction: 'delete the voice' })
        ),
      });
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

    logger.info(
      { userId, provider: parsed.provider, voiceId: parsed.voiceId, slug: result.data.slug },
      'Deleted voice'
    );
  } catch (error) {
    logger.error({ err: error, userId }, 'Unexpected error');
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, 'voice', { failedAction: 'delete the voice' })
      ),
    });
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
      const { userClient } = clientsFor(interaction);
      const result = await userClient.listVoices();

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

    const choices = filtered.map(v =>
      // Display: `slug · provider` so the user can disambiguate same-slug
      // voices across providers (e.g., a personality cloned to both).
      // Value: composite `${provider}:${voiceId}` — the delete handler
      // splits on `:` to route to the right provider's API.
      formatAutocompleteOption({
        name: v.slug,
        value: `${v.provider}:${v.voiceId}`,
        metadata: v.provider,
      })
    );

    await interaction.respond(choices);
  } catch (error) {
    logger.error({ err: error, userId }, 'Error');
    await interaction.respond([]);
  }
}
