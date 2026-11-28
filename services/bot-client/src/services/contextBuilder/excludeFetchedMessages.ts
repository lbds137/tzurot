/**
 * Drops named Discord messages from a live extended-context fetch.
 *
 * A reroll replaces a reply that still exists on Discord while the new one is
 * generated, so a weigh-in fetch (which reads the room including its latest
 * message) would hand the old reply to the model as context. The exclusion
 * happens on the fetch result itself, before the raw snapshot is captured and
 * before the merge, so every downstream consumer sees the same filtered set.
 */

import type { FetchResult } from '../channelFetcher/types.js';

/**
 * Return the fetch result without any message whose Discord ids intersect
 * `excludeDiscordMessageIds`, with `keptCount` kept equal to the surviving
 * message count. The input is returned unchanged when nothing is excluded.
 */
export function excludeFetchedMessages(
  fetchResult: FetchResult,
  excludeDiscordMessageIds: readonly string[] | undefined
): FetchResult {
  if (excludeDiscordMessageIds === undefined || excludeDiscordMessageIds.length === 0) {
    return fetchResult;
  }
  const excluded = new Set(excludeDiscordMessageIds);
  const messages = fetchResult.messages.filter(
    message => !message.discordMessageId.some(id => excluded.has(id))
  );
  if (messages.length === fetchResult.messages.length) {
    return fetchResult;
  }
  return { ...fetchResult, messages, keptCount: messages.length };
}
