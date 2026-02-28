/**
 * Cross-Channel History Fetcher
 *
 * Fetches conversation history from other channels where the same user+personality
 * have interacted. Used to fill unused context budget when the current channel
 * has fewer messages than maxMessages.
 */

import type { Client } from 'discord.js';
import { ChannelType } from 'discord.js';
import {
  ConversationHistoryService,
  createLogger,
  type CrossChannelHistoryGroup,
  type CrossChannelHistoryGroupEntry,
  type DiscordEnvironment,
} from '@tzurot/common-types';

const logger = createLogger('CrossChannelHistoryFetcher');

/** A single cross-channel group with resolved Discord environment */
export interface ResolvedCrossChannelGroup {
  channelEnvironment: DiscordEnvironment;
  messages: CrossChannelHistoryGroup['messages'];
}

/** Options for fetching cross-channel history */
interface FetchOptions {
  personaId: string;
  personalityId: string;
  currentChannelId: string;
  /** Maximum number of messages to fetch across all channels (DB row limit, not token budget) */
  remainingMessageCount: number;
  discordClient: Client;
  conversationHistoryService: ConversationHistoryService;
}

/**
 * Resolve a Discord channel ID to a DiscordEnvironment.
 * Returns a minimal fallback environment if the channel can't be fetched.
 */
async function resolveChannelEnvironment(
  discordClient: Client,
  channelId: string,
  guildId: string | null
): Promise<DiscordEnvironment> {
  try {
    const channel = await discordClient.channels.fetch(channelId);
    if (channel === null) {
      return buildFallbackEnvironment(channelId, guildId);
    }

    if (channel.type === ChannelType.DM) {
      return {
        type: 'dm',
        channel: { id: channel.id, name: 'Direct Message', type: 'dm' },
      };
    }

    if ('guild' in channel && channel.guild !== null && channel.guild !== undefined) {
      return buildGuildEnvironment(channel);
    }

    return buildFallbackEnvironment(channelId, guildId);
  } catch (error) {
    logger.warn(
      { err: error, channelId },
      '[CCHF] Failed to fetch channel, using fallback environment'
    );
    return buildFallbackEnvironment(channelId, guildId);
  }
}

/** Build a DiscordEnvironment for a guild channel (text, thread, forum, etc.) */
function buildGuildEnvironment(
  channel: Extract<Awaited<ReturnType<Client['channels']['fetch']>>, { guild: unknown }>
): DiscordEnvironment {
  const guild = channel.guild;
  const env: DiscordEnvironment = {
    type: 'guild',
    guild: { id: guild.id, name: guild.name },
    channel: {
      id: channel.id,
      name: 'name' in channel ? (channel.name ?? 'Unknown') : 'Unknown',
      type: getChannelTypeName(channel.type),
    },
  };

  // Threads always have parents in normal Discord state; parent === null would only occur
  // during deletion race conditions. In that case, the thread appears as a regular channel.
  if (channel.isThread() && channel.parent !== null) {
    env.thread = {
      id: channel.id,
      name: channel.name,
      parentChannel: {
        id: channel.parent.id,
        name: channel.parent.name,
        type: getChannelTypeName(channel.parent.type),
      },
    };
    env.channel = {
      id: channel.parent.id,
      name: channel.parent.name,
      type: getChannelTypeName(channel.parent.type),
    };
  }

  if ('parent' in channel && !channel.isThread()) {
    const parent = channel.parent;
    if (parent?.type === ChannelType.GuildCategory) {
      env.category = { id: parent.id, name: parent.name };
    }
  }

  return env;
}

/** Build a minimal fallback environment when Discord channel fetch fails */
function buildFallbackEnvironment(channelId: string, guildId: string | null): DiscordEnvironment {
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

/** Convert Discord ChannelType to human-readable name */
function getChannelTypeName(type: ChannelType): string {
  const typeNames: Partial<Record<ChannelType, string>> = {
    [ChannelType.GuildText]: 'text',
    [ChannelType.DM]: 'dm',
    [ChannelType.GuildVoice]: 'voice',
    [ChannelType.PublicThread]: 'public-thread',
    [ChannelType.PrivateThread]: 'private-thread',
    [ChannelType.GuildForum]: 'forum',
    [ChannelType.GuildAnnouncement]: 'announcement',
  };
  const name = typeNames[type];
  if (name === undefined) {
    logger.debug({ channelType: type }, '[CCHF] Unmapped Discord channel type');
  }
  return name ?? 'unknown';
}

/**
 * Fetch cross-channel conversation history and resolve Discord environments.
 *
 * Queries the database for conversation history from other channels where
 * this user+personality have interacted, then resolves each channel to a
 * DiscordEnvironment for XML location blocks.
 *
 * @returns Resolved groups with Discord environment context, or empty array
 */
export async function fetchCrossChannelHistory(
  opts: FetchOptions
): Promise<ResolvedCrossChannelGroup[]> {
  const {
    personaId,
    personalityId,
    currentChannelId,
    remainingMessageCount,
    discordClient,
    conversationHistoryService,
  } = opts;

  if (remainingMessageCount <= 0) {
    return [];
  }

  const groups = await conversationHistoryService.getCrossChannelHistory(
    personaId,
    personalityId,
    currentChannelId,
    remainingMessageCount
  );

  if (groups.length === 0) {
    logger.debug({ personaId, personalityId }, '[CCHF] No cross-channel history found');
    return [];
  }

  // Resolve Discord environments for each channel group in parallel
  const resolvedGroups: ResolvedCrossChannelGroup[] = await Promise.all(
    groups.map(async group => {
      const channelEnvironment = await resolveChannelEnvironment(
        discordClient,
        group.channelId,
        group.guildId
      );
      return {
        channelEnvironment,
        messages: group.messages,
      };
    })
  );

  const totalMessages = resolvedGroups.reduce((sum, g) => sum + g.messages.length, 0);
  logger.info(
    {
      personaId,
      personalityId,
      groupCount: resolvedGroups.length,
      totalMessages,
    },
    '[CCHF] Fetched cross-channel history'
  );

  return resolvedGroups;
}

/**
 * Fetch cross-channel history if enabled and there's remaining budget.
 * Returns undefined if disabled or no room for additional history.
 */
export async function fetchCrossChannelIfEnabled(opts: {
  enabled: boolean;
  channelId: string;
  personaId: string;
  personalityId: string;
  currentHistoryLength: number;
  dbLimit: number;
  discordClient: Client;
  conversationHistoryService: ConversationHistoryService;
}): Promise<ResolvedCrossChannelGroup[] | undefined> {
  if (!opts.enabled) {
    return undefined;
  }

  const remainingMessageCount = opts.dbLimit - opts.currentHistoryLength;
  if (remainingMessageCount <= 0) {
    logger.debug(
      {
        channelId: opts.channelId,
        currentHistoryLength: opts.currentHistoryLength,
        dbLimit: opts.dbLimit,
      },
      '[CCHF] No remaining message count for cross-channel history'
    );
    return undefined;
  }

  const groups = await fetchCrossChannelHistory({
    personaId: opts.personaId,
    personalityId: opts.personalityId,
    currentChannelId: opts.channelId,
    remainingMessageCount,
    discordClient: opts.discordClient,
    conversationHistoryService: opts.conversationHistoryService,
  });

  return groups.length > 0 ? groups : undefined;
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
