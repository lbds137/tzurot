/**
 * Database sync executor for DiscordChannelFetcher.
 *
 * Thin discord.js adapter over ConversationSyncService.runSync — maps the
 * fetched message Collection to the plain observed-message shape and
 * delegates. The diff algorithm itself lives in common-types so the
 * api-gateway sync endpoint and this legacy direct path share one
 * implementation.
 */

import type { Message, Collection } from 'discord.js';
import type { ConversationSyncService, ObservedSyncMessage } from '@tzurot/common-types';
import { dualWriteConversationSync } from '../../utils/gatewayServiceCalls.js';
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
export async function executeDatabaseSync(
  discordMessages: Collection<string, Message>,
  channelId: string,
  personalityId: string,
  conversationSync: ConversationSyncService
): Promise<SyncResult> {
  const observed = toObservedSyncMessages(discordMessages);
  const result = await conversationSync.runSync(channelId, personalityId, observed);

  // Phase 2.5 dual-write: replay the same snapshot against the gateway
  // endpoint for burn-in verification. The local sync just ran, so the
  // gateway should find zero work. Fire-and-forget, no-op unless
  // CONTEXT_DUAL_WRITE=true.
  void dualWriteConversationSync(channelId, personalityId, observed);

  return result;
}
