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

import { MessageRole } from '../constants/message.js';
import type { CrossChannelRenderMode } from '../schemas/api/configOverrides.js';
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

/**
 * Apply the cross-channel render mode to mapped groups.
 *
 * `'both'` returns the input array itself — no copy, no reorder — so the default
 * path stays allocation-free. `'user-only'` keeps each group's `role === 'user'`
 * rows and drops any group left with none, so the rendered block carries the
 * user's turns alone and an all-assistant channel contributes nothing. Pure: the
 * input groups and their message arrays are never mutated.
 *
 * Filtering here rather than in the serializer keeps the token budget honest —
 * the budget then measures only rows that will render.
 */
export function applyCrossChannelRenderMode(
  groups: CrossChannelHistoryGroupEntry[],
  mode: CrossChannelRenderMode
): CrossChannelHistoryGroupEntry[] {
  if (mode === 'both') {
    return groups;
  }
  const filtered: CrossChannelHistoryGroupEntry[] = [];
  for (const group of groups) {
    const messages = group.messages.filter(msg => msg.role === MessageRole.User);
    if (messages.length > 0) {
      filtered.push({ channelEnvironment: group.channelEnvironment, messages });
    }
  }
  return filtered;
}
