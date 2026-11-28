/**
 * The Discord user a reroll runs as.
 *
 * A reroll is billed to, and resolves its persona for, the owner of the
 * persona that spoke the original turn, even when the bot owner clicks the
 * menu item. Both reroll paths (triggered and weigh-in) take their
 * `overrideUser` from here, so there is exactly one place that decides it.
 */

import type { Client, User } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('reroll-turn-user');

/**
 * Fetch the persona owner's `User`, or `null` when Discord no longer knows
 * them (the caller refuses the reroll rather than billing someone else).
 */
export async function resolveRerollTurnUser(
  client: Client,
  ownerDiscordId: string
): Promise<User | null> {
  try {
    return await client.users.fetch(ownerDiscordId);
  } catch (err) {
    logger.warn({ err, ownerDiscordId }, 'Could not fetch the reroll turn owner');
    return null;
  }
}
