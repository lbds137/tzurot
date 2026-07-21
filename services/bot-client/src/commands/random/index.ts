/**
 * Random Command
 * Top-level `/random` — chat with a randomly picked character.
 *
 * Thin command surface over the shared character-turn engine
 * (services/character/characterTurn.ts), which also powers `/chat` and
 * `/character chime-in`. Extracted from `/character random`: invoking a
 * character is the bot's primary action, so it lives at the top level.
 *
 * With a message it's a chat; with no message the random pick reads the
 * room (weigh-in mode). The "🎲 Picked X" notice replaces the deferred
 * reply so participants can see the pick was random rather than directed.
 */

import { SlashCommandBuilder } from 'discord.js';
import {
  defineCommand,
  type DeferredCommandContext,
  type SafeCommandContext,
} from '../../utils/defineCommand.js';
import { handleRandom } from '../../services/character/characterTurn.js';

async function execute(ctx: SafeCommandContext): Promise<void> {
  await handleRandom(ctx as DeferredCommandContext);
}

export default defineCommand({
  deferralMode: 'ephemeral',
  data: new SlashCommandBuilder()
    .setName('random')
    .setDescription('Chat with a random character — or, with no message, have them read the room')
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription(
          'Message to send (leave empty to have the random pick react to recent chat)'
        )
        .setRequired(false)
        .setMaxLength(2000)
    )
    .addBooleanOption(option =>
      option
        .setName('incognito')
        .setDescription(
          'Hide your persona & memories. Defaults on with no message, off when you send one.'
        )
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName('exclude-private')
        .setDescription('Only consider public characters (skip your private ones)')
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName('only-mine')
        .setDescription('Only consider characters you own (composable with exclude-private)')
        .setRequired(false)
    ),
  execute,
});
