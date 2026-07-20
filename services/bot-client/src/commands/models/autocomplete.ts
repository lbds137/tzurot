/**
 * Models Autocomplete Handler
 *
 * Autocomplete for `/models view <model>`. Uses the merged catalog so z.ai-only
 * models (e.g. `glm-5.2`, absent from OpenRouter) are suggestable too.
 */

import type { AutocompleteInteraction } from 'discord.js';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import {
  AUTOCOMPLETE_BADGES,
  formatAutocompleteOption,
} from '@tzurot/common-types/utils/autocompleteFormat';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { formatContextLength } from '../../utils/modelAutocomplete.js';
import { fetchModelCatalog } from '../../utils/modelCatalog.js';

const logger = createLogger('models-autocomplete');

/** Discord caps choice name/value at 100 chars (the formatter caps the name). */
const MAX_CHOICE_VALUE_LEN = 100;

export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const query = interaction.options.getFocused();

  try {
    const catalog = await fetchModelCatalog({
      search: query.length > 0 ? query : undefined,
      limit: DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES,
    });

    // Re-cap after the catalog merge: the fetch limit bounds only the OpenRouter
    // half, and fetchModelCatalog adds up to ~6 z.ai entries on top, so the
    // merged list can exceed Discord's 25-choice ceiling.
    const choices = catalog.slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES).map(model =>
      formatAutocompleteOption({
        name: model.name,
        value: model.id.slice(0, MAX_CHOICE_VALUE_LEN),
        statusBadges: model.isZaiCoding ? [AUTOCOMPLETE_BADGES.ZAI_CODING] : undefined,
        metadata: formatContextLength(model.contextLength),
      })
    );

    await interaction.respond(choices);
  } catch (error) {
    logger.error({ err: error, query }, 'Model autocomplete failed');
    await interaction.respond([]);
  }
}
