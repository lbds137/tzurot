/**
 * Shapes Slug Autocomplete Handler
 *
 * Provides autocomplete suggestions for the `slug` option on
 * /shapes import and /shapes export subcommands. Fetches the user's
 * shapes list via the autocomplete cache to avoid flooding the gateway
 * on every keystroke.
 */

import type { AutocompleteInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { getCachedShapes } from '../../utils/autocomplete/autocompleteCache.js';
import { truncateForSelect } from '../../utils/browse/truncation.js';

const logger = createLogger('shapes-autocomplete');

const MAX_AUTOCOMPLETE_RESULTS = 25;

/**
 * Handle autocomplete for shapes slug options.
 * Matches the focused query against shape name and username.
 */
export async function handleShapesSlugAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const query = interaction.options.getFocused().toLowerCase().trim();
  const userId = interaction.user.id;

  try {
    const shapes = await getCachedShapes(userId);

    const filtered = shapes
      .filter(s => s.name.toLowerCase().includes(query) || s.username.toLowerCase().includes(query))
      .slice(0, MAX_AUTOCOMPLETE_RESULTS);

    await interaction.respond(
      filtered.map(s => ({
        name: truncateForSelect(`${s.name} \u00B7 ${s.username}`, 100),
        value: s.username,
      }))
    );
  } catch (error) {
    logger.error({ err: error, userId }, '[Shapes] Autocomplete error');
    await interaction.respond([]);
  }
}
