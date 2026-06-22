/**
 * Cross-channel environment + wire-format kernels, shared by bot-client's
 * CrossChannelHistoryFetcher and ai-worker's context assembler.
 *
 * Shared-implementation guarantee: the wire serialization
 * (`mapCrossChannelToApiFormat`) and the fallback environment shape are the
 * SAME functions on both sides, so cross-channel payload entries cannot
 * drift between the legacy bot path and the worker-side re-derivation.
 *
 * What stays caller-side: HOW a channel id resolves to a DiscordEnvironment.
 * Bot-client live-fetches the channel from Discord; ai-worker looks it up in
 * the envelope's knownChannelEnvironments map. Both degrade to the fallback
 * built here when resolution fails.
 */

import type { ConversationMessage } from '../types/conversationMessage.js';
import type { DiscordEnvironment } from '../types/schemas/discord.js';
import type { CrossChannelHistoryGroupEntry } from '../types/schemas/message.js';

/** A single cross-channel group with its resolved Discord environment. */
export interface ResolvedCrossChannelGroup {
  channelEnvironment: DiscordEnvironment;
  messages: ConversationMessage[];
}

/** Build a minimal fallback environment when channel resolution fails. */
export function buildFallbackEnvironment(
  channelId: string,
  guildId: string | null
): DiscordEnvironment {
  if (guildId === null) {
    return {
      type: 'dm',
      channel: { id: channelId, name: 'Direct Message', type: 'dm' },
    };
  }
  return {
    type: 'guild',
    guild: { id: guildId, name: 'unknown-server' },
    channel: { id: channelId, name: 'unknown-channel', type: 'text' },
  };
}

/**
 * Map resolved cross-channel groups to the API/job payload format (Date→string serialization).
 * Note: `discordMessageId` is intentionally omitted — it's only used for current-channel
 * quote deduplication and is not relevant for cross-channel historical context.
 */
export function mapCrossChannelToApiFormat(
  groups: ResolvedCrossChannelGroup[]
): CrossChannelHistoryGroupEntry[] {
  return groups.map(group => ({
    channelEnvironment: group.channelEnvironment,
    messages: group.messages.map(msg => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      tokenCount: msg.tokenCount,
      createdAt: msg.createdAt.toISOString(),
      personaId: msg.personaId,
      personaName: msg.personaName,
      discordUsername: msg.discordUsername,
      personalityId: msg.personalityId,
      personalityName: msg.personalityName,
    })),
  }));
}
