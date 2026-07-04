/**
 * Database sync executor for DiscordChannelFetcher.
 *
 * Maps the fetched Discord message Collection to the plain observed-message
 * shape and runs edit/delete sync via the gateway endpoint. The diff algorithm
 * lives in common-types so the api-gateway sync endpoint and bot-client share
 * one implementation.
 */

import type { Message, Collection } from 'discord.js';
import type { ObservedSyncMessage } from '@tzurot/common-types/services/conversationSyncDiff';
import { syncConversationViaGateway } from '../../utils/gatewayWriteHelpers.js';
import type { SyncResult } from './types.js';

/**
 * Map a fetched Discord message Collection to the plain shape the sync
 * algorithm (and the gateway sync endpoint) consumes.
 */
export function toObservedSyncMessages(
  discordMessages: Collection<string, Message>
): ObservedSyncMessage[] {
  return [...discordMessages.values()].map(m => ({
    id: m.id,
    content: m.content,
    createdAt: m.createdAt,
  }));
}

/**
 * Perform opportunistic sync between Discord messages and database.
 */
export function executeDatabaseSync(
  discordMessages: Collection<string, Message>,
  channelId: string,
  personalityId: string
): Promise<SyncResult> {
  const observed = toObservedSyncMessages(discordMessages);
  // The gateway endpoint IS the sync path: never throws, zero counts on
  // failure — opportunistic, same contract as the old local runSync.
  return syncConversationViaGateway(channelId, personalityId, observed);
}
