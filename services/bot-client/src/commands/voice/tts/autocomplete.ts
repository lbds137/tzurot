/**
 * Voice TTS Autocomplete Handler
 * Provides autocomplete suggestions for personality and tts options.
 *
 * Mirrors `commands/preset/override/autocomplete.ts` shape:
 *  - personality option → reuse handlePersonalityAutocomplete
 *  - tts option → fetch /user/tts-config, format with provider badges
 *
 * No guest-mode gate parallel to LLM (which has free-vs-paid model logic).
 * Instead, the BYOK gate fires at command time via `checkTtsByokAccess` —
 * autocomplete shows everything available so the user can see what they
 * COULD pick if they configured the relevant key.
 */

import type { AutocompleteInteraction } from 'discord.js';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import {
  AUTOCOMPLETE_BADGES,
  formatAutocompleteOption,
  type AutocompleteBadge,
} from '@tzurot/common-types/utils/autocompleteFormat';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { handlePersonalityAutocomplete } from '../../../utils/autocomplete/index.js';
import {
  runGuardedAutocomplete,
  CHARACTER_ID_AUTOCOMPLETE,
} from '../../../utils/autocomplete/guardedAutocomplete.js';

const logger = createLogger('voice-tts-autocomplete');

/** Handle autocomplete for /voice tts commands */
export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);
  const userId = interaction.user.id;

  await runGuardedAutocomplete(interaction, logger, async () => {
    if (focusedOption.name === 'character') {
      await handlePersonalityAutocomplete(interaction, CHARACTER_ID_AUTOCOMPLETE);
    } else if (focusedOption.name === 'tts') {
      await handleTtsConfigAutocomplete(interaction, focusedOption.value, userId);
    } else {
      await interaction.respond([]);
    }
  });
}

async function handleTtsConfigAutocomplete(
  interaction: AutocompleteInteraction,
  query: string,
  userId: string
): Promise<void> {
  const { userClient } = clientsFor(interaction);
  const result = await userClient.listUserTtsConfigs();

  if (!result.ok) {
    logger.warn({ userId, error: result.error }, 'Failed to fetch TTS configs');
    await interaction.respond([]);
    return;
  }

  const queryLower = query.toLowerCase();

  // Filter by query against name, provider, and modelId. Description-search
  // intentionally omitted — TTS descriptions are short marketing strings,
  // not searchable content.
  const filtered = result.data.configs
    .filter(c => {
      return (
        c.name.toLowerCase().includes(queryLower) ||
        c.provider.toLowerCase().includes(queryLower) ||
        (c.modelId?.toLowerCase().includes(queryLower) ?? false)
      );
    })
    .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

  // Format choices: provider tag + scope/status badges. The provider tag
  // (`elevenlabs`, `mistral`, `self-hosted`) doubles as a UX hint about
  // BYOK requirements — users see at a glance which configs need their key.
  const choices = filtered.map(c => {
    const statusBadges: AutocompleteBadge[] = [];
    if (c.provider === 'self-hosted') {
      statusBadges.push(AUTOCOMPLETE_BADGES.FREE);
    }
    if (c.isDefault) {
      statusBadges.push(AUTOCOMPLETE_BADGES.DEFAULT);
    }

    return formatAutocompleteOption({
      name: c.name,
      value: c.id,
      scopeBadge: c.isGlobal ? AUTOCOMPLETE_BADGES.GLOBAL : AUTOCOMPLETE_BADGES.OWNED,
      statusBadges: statusBadges.length > 0 ? statusBadges : undefined,
      metadata: c.provider,
    });
  });

  await interaction.respond(choices);
}
