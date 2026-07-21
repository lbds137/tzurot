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
 */

import { SlashCommandBuilder, type AutocompleteInteraction } from 'discord.js';
import { SELECTOR_DESCRIPTION } from '@tzurot/common-types/constants/uxVocabulary';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  defineCommand,
  type DeferredCommandContext,
  type SafeCommandContext,
} from '../../utils/defineCommand.js';
import { handleChimeIn } from '../../services/character/characterTurn.js';
import { handlePersonalityAutocomplete } from '../../utils/autocomplete/index.js';
import { runGuardedAutocomplete } from '../../utils/autocomplete/guardedAutocomplete.js';

const logger = createLogger('chime-in-command');

async function execute(ctx: SafeCommandContext): Promise<void> {
  await handleChimeIn(ctx as DeferredCommandContext);
}

/**
 * Autocomplete for the `character` option — all accessible characters
 * (owned + public), matching the turn engine's loadable pool.
 */
async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await runGuardedAutocomplete(interaction, logger, async () => {
    const handled = await handlePersonalityAutocomplete(interaction, {
      optionName: 'character',
      ownedOnly: false,
      showVisibility: true,
    });
    if (!handled) {
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
        .setRequired(true)
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
