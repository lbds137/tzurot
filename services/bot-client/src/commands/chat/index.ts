/**
 * Chat Command
 * Top-level `/chat` — chat one-on-one with a character.
 *
 * Thin command surface over the shared character-turn engine
 * (services/character/characterTurn.ts), which also powers `/random` and
 * `/character chime-in`. Extracted from `/character chat`: invoking a
 * character is the bot's primary action, so it lives at the top level;
 * configuring characters stays under `/character`.
 *
 * This command uses deferralMode: 'ephemeral' so the random-pick notice and
 * error responses (editReply) land as invoker-only messages. The user-mirror
 * (`channel.send` in characterTurn.ts) and the character's webhook reply are
 * independent of the defer mode and remain public.
 */

import { SlashCommandBuilder, type AutocompleteInteraction } from 'discord.js';
import { SELECTOR_DESCRIPTION } from '@tzurot/common-types/constants/uxVocabulary';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  defineCommand,
  type DeferredCommandContext,
  type SafeCommandContext,
} from '../../utils/defineCommand.js';
import { handleChat } from '../../services/character/characterTurn.js';
import { handlePersonalityAutocomplete } from '../../utils/autocomplete/index.js';
import { runGuardedAutocomplete } from '../../utils/autocomplete/guardedAutocomplete.js';

const logger = createLogger('chat-command');

async function execute(ctx: SafeCommandContext): Promise<void> {
  await handleChat(ctx as DeferredCommandContext);
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
    .setName('chat')
    .setDescription('Chat one-on-one with a character')
    .addStringOption(option =>
      option
        .setName('character')
        .setDescription(SELECTOR_DESCRIPTION.character)
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('Message to send to the character')
        .setRequired(true)
        .setMaxLength(2000)
    ),
  execute,
  autocomplete,
});
