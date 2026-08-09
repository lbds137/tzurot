/**
 * Shared Character-Tag Autocomplete Utility
 *
 * Offers the discovery-tag vocabulary in use across the invoker's ACCESSIBLE
 * characters (owned + public) — the same pool `handlePersonalityAutocomplete`
 * serves from, and for the same reason: a tag that exists only on somebody
 * else's private character must not leak into the dropdown, since the
 * vocabulary itself would reveal that the character exists.
 *
 * Tags are offered most-used-first (ties alphabetical) so the dropdown opens on
 * the tags most likely to produce a populated pool. The vocabulary's page-size
 * bound is documented in `services/character/tagPool.ts`.
 */

import type { AutocompleteInteraction } from 'discord.js';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { normalizeTag } from '@tzurot/common-types/schemas/api/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getCachedPersonalities } from './autocompleteCache.js';
import { clientsFor } from '../gatewayClients.js';
import { AUTOCOMPLETE_ERROR_SENTINEL } from '../apiCheck.js';
import { collectTagVocabulary } from '../../services/character/tagPool.js';

const logger = createLogger('tag-autocomplete');

/** Options for tag autocomplete behavior. */
interface TagAutocompleteOptions {
  /** Option name(s) to claim (defaults to 'tag'). */
  optionName?: string | string[];
}

const DEFAULT_OPTION_NAMES = ['tag'];

/**
 * Handle character-tag autocomplete for any command.
 *
 * @returns Whether this handler claimed the focused option. `false` means the
 *   caller should try another handler — mirroring
 *   `handlePersonalityAutocomplete`, so a command with both a `character` and a
 *   `tag` option can chain the two.
 */
export async function handleTagAutocomplete(
  interaction: AutocompleteInteraction,
  options: TagAutocompleteOptions = {}
): Promise<boolean> {
  const focusedOption = interaction.options.getFocused(true);
  const configured = options.optionName ?? DEFAULT_OPTION_NAMES;
  const optionNames = Array.isArray(configured) ? configured : [configured];

  if (!optionNames.includes(focusedOption.name)) {
    return false;
  }

  try {
    const { userClient } = clientsFor(interaction);
    const result = await getCachedPersonalities(userClient);
    if (result.kind === 'error') {
      // Same reasoning as the personality handler: an empty list would read as
      // "no tags exist", which is a silent lie during a backend outage.
      await interaction.respond([
        { name: '[Unable to load tags — try again]', value: AUTOCOMPLETE_ERROR_SENTINEL },
      ]);
      return true;
    }

    // Normalized the same way `filterByTag` will normalize a submitted value,
    // so the dropdown never says "nothing" for a query that would match on
    // submit (typing `sci fi` must surface the stored `sci-fi`).
    const query = normalizeTag(focusedOption.value);
    const choices = collectTagVocabulary(result.value)
      .filter(entry => query.length === 0 || entry.tag.includes(query))
      .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES)
      .map(entry => ({
        name: `${entry.tag} — ${entry.count} ${entry.count === 1 ? 'character' : 'characters'}`,
        value: entry.tag,
      }));

    await interaction.respond(choices);
    return true;
  } catch (error) {
    logger.error(
      {
        err: error,
        option: focusedOption.name,
        query: focusedOption.value,
        userId: interaction.user.id,
        guildId: interaction.guildId,
      },
      'Tag autocomplete error'
    );
    await interaction.respond([]);
    return true;
  }
}
