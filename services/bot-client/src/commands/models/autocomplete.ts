/**
 * Models Autocomplete Handler
 *
 * Autocomplete for `/models view <model>` — delegates to the shared
 * merged-catalog responder so z.ai-only models are suggestable too.
 */

import type { AutocompleteInteraction } from 'discord.js';
import { respondWithCatalogAutocomplete } from '../../utils/modelCatalogAutocomplete.js';

export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await respondWithCatalogAutocomplete(interaction, interaction.options.getFocused());
}
