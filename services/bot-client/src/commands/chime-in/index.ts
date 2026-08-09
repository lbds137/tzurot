/**
 * Chime-In Command
 * Top-level `/chime-in` — have a character react to the recent conversation.
 *
 * Thin command surface over the shared character-turn engine
 * (services/character/characterTurn.ts), which also powers `/chat` and
 * `/random`. Extracted from `/character chime-in`: summoning a character is
 * an invoke action, so it lives top-level beside its sibling turn commands.
 *
 * The summon carries no message from the invoker (weigh-in semantics:
 * anonymous by default — no persona attachment, no long-term-memory
 * read/write; the `incognito` option overrides the anonymity).
 *
 * Two selectors, exactly one of which must be given:
 *  - `character` — that one character weighs in.
 *  - `tag` — every accessible character carrying the tag weighs in, capped and
 *    randomly sampled by the admin multi-character cap (see chimeInTag.ts).
 *
 * Discord has no native XOR between options, and it requires required options
 * to precede optional ones — so BOTH are declared optional and the exclusivity
 * is enforced here at runtime. This command surface owns that check: the
 * engine's `handleChimeIn` takes the resolved slug as a parameter precisely so
 * a missing selector can never reach it and fall through to a random pick.
 */

import { SlashCommandBuilder, type AutocompleteInteraction } from 'discord.js';
import { SELECTOR_DESCRIPTION } from '@tzurot/common-types/constants/uxVocabulary';
import { chimeInOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  defineCommand,
  type DeferredCommandContext,
  type SafeCommandContext,
} from '../../utils/defineCommand.js';
import { handleChimeIn } from '../../services/character/characterTurn.js';
import {
  runTagChimeIn,
  CHIME_IN_SELECTOR_USAGE_DETAIL,
} from '../../services/character/chimeInTag.js';
import {
  handlePersonalityAutocomplete,
  handleTagAutocomplete,
} from '../../utils/autocomplete/index.js';
import { runGuardedAutocomplete } from '../../utils/autocomplete/guardedAutocomplete.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';

const logger = createLogger('chime-in-command');

async function execute(ctx: SafeCommandContext): Promise<void> {
  const context = ctx as DeferredCommandContext;
  const options = chimeInOptions(context.interaction);
  const character = options.character();
  const tag = options.tag();

  // XOR, written as its two satisfying arms so each narrows its own selector —
  // an `if (bothOrNeither) return;` guard would leave both still nullable.
  if (character !== null && tag === null) {
    await handleChimeIn(context, character);
    return;
  }
  if (tag !== null && character === null) {
    await runTagChimeIn(context, { tag, incognitoOption: options.incognito() });
    return;
  }
  await context.editReply({
    content: renderSpec(CATALOG.error.validation(CHIME_IN_SELECTOR_USAGE_DETAIL)),
  });
}

/**
 * Autocomplete for the two selectors — `character` offers all accessible
 * characters (owned + public, matching the turn engine's loadable pool),
 * `tag` offers the tag vocabulary across that same pool.
 */
async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await runGuardedAutocomplete(interaction, logger, async () => {
    const handledCharacter = await handlePersonalityAutocomplete(interaction, {
      optionName: 'character',
      ownedOnly: false,
      showVisibility: true,
    });
    if (handledCharacter) {
      return;
    }
    const handledTag = await handleTagAutocomplete(interaction, { optionName: 'tag' });
    if (!handledTag) {
      await interaction.respond([]);
    }
  });
}

export default defineCommand({
  deferralMode: 'ephemeral',
  data: new SlashCommandBuilder()
    .setName('chime-in')
    .setDescription('Have a character chime in on the recent conversation (no message from you)')
    .addStringOption(option =>
      option
        .setName('character')
        .setDescription(SELECTOR_DESCRIPTION.character)
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option
        .setName('tag')
        .setDescription('Have every character carrying this tag chime in instead')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addBooleanOption(option =>
      option
        .setName('incognito')
        .setDescription(
          'Anonymous by default (no persona/memories). Set False to use your persona + memories.'
        )
        .setRequired(false)
    ),
  execute,
  autocomplete,
});
