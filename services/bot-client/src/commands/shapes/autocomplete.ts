/**
 * Shapes Slug Autocomplete Handler
 *
 * Provides autocomplete suggestions for the `slug` option on
 * /shapes import and /shapes export subcommands. Fetches the user's
 * shapes list via the autocomplete cache to avoid flooding the gateway
 * on every keystroke.
 */

import type { AutocompleteInteraction } from 'discord.js';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { formatAutocompleteOption } from '@tzurot/common-types/utils/autocompleteFormat';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getCachedShapes } from '../../utils/autocomplete/autocompleteCache.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { AUTOCOMPLETE_ERROR_SENTINEL } from '../../utils/apiCheck.js';

const logger = createLogger('shapes-autocomplete');

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
    const { userClient } = clientsFor(interaction);
    const result = await getCachedShapes(userClient);
    if (result.kind === 'error') {
      // Backend failed AND no stale cache to fall back on. Render a visible
      // error choice instead of an empty list — an empty list reads as
      // "you have no shapes," which is a silent lie during a backend outage.
      await interaction.respond([
        { name: '[Unable to load shapes — try again]', value: AUTOCOMPLETE_ERROR_SENTINEL },
      ]);
      return;
    }

    const filtered = result.value
      .filter(s => s.name.toLowerCase().includes(query) || s.username.toLowerCase().includes(query))
      .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

    await interaction.respond(
      filtered.map(s =>
        formatAutocompleteOption({
          name: s.name,
          value: s.username,
          metadata: s.username,
        })
      )
    );
  } catch (error) {
    logger.error({ err: error, userId }, 'Autocomplete error');
    await interaction.respond([]);
  }
}
