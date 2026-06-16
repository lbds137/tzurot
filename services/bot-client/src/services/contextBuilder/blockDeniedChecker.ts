/**
 * Block-denied predicate factory for the extended-context fetch.
 *
 * Extracted from MessageContextBuilder so that file stays within the max-lines
 * budget and the closure gets a colocated test. The predicate answers "is this
 * Discord user BLOCK-denied for this personality, in this channel/thread?" and
 * is handed to `DiscordChannelFetcher` to filter denied users out of context.
 */

import type { Message } from 'discord.js';
import { getThreadParentId } from '../../utils/discordChannelTypes.js';
import type { DenylistCache } from '../DenylistCache.js';

/**
 * Build the `isBlockDenied` predicate, or `undefined` when no denylist cache is
 * configured (the fetcher treats an absent predicate as "filter nothing").
 *
 * @param denylistCache - the per-replica denylist cache, or undefined
 * @param message - the trigger message (source of guild/channel/thread scope)
 * @param personalityId - the responding personality's id (denylist is per-personality)
 */
export function buildBlockDeniedChecker(
  denylistCache: DenylistCache | undefined,
  message: Message,
  personalityId: string
): ((discordUserId: string) => boolean) | undefined {
  const cache = denylistCache;
  if (cache === undefined) {
    return undefined;
  }
  return (discordUserId: string): boolean =>
    cache.isBlocked(
      discordUserId,
      message.guildId ?? undefined,
      message.channelId,
      personalityId,
      getThreadParentId(message.channel) ?? undefined
    );
}
