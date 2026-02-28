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
  type ConversationMessage,
  type CrossChannelHistoryGroup,
  type DiscordEnvironment,
  type LoadedPersonality,
  type MessageRole,
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
  remainingBudget: number;
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
    logger.debug(
      { err: error, channelId },
      '[CrossChannelHistoryFetcher] Failed to fetch channel, using fallback environment'
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
  return typeNames[type] ?? 'unknown';
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
    remainingBudget,
    discordClient,
    conversationHistoryService,
  } = opts;

  if (remainingBudget <= 0) {
    return [];
  }

  const groups = await conversationHistoryService.getCrossChannelHistory(
    personaId,
    personalityId,
    currentChannelId,
    remainingBudget
  );

  if (groups.length === 0) {
    logger.debug(
      { personaId, personalityId },
      '[CrossChannelHistoryFetcher] No cross-channel history found'
    );
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
    '[CrossChannelHistoryFetcher] Fetched cross-channel history'
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
  personality: LoadedPersonality;
  currentHistory: ConversationMessage[];
  dbLimit: number;
  discordClient: Client;
  conversationHistoryService: ConversationHistoryService;
}): Promise<ResolvedCrossChannelGroup[] | undefined> {
  if (!opts.enabled) {
    return undefined;
  }

  const remainingBudget = opts.dbLimit - opts.currentHistory.length;
  if (remainingBudget <= 0) {
    logger.debug(
      {
        channelId: opts.channelId,
        currentHistoryLength: opts.currentHistory.length,
        dbLimit: opts.dbLimit,
      },
      '[CrossChannelHistoryFetcher] No remaining budget for cross-channel history'
    );
    return undefined;
  }

  const personaId = opts.currentHistory.find(msg => msg.personaId !== undefined)?.personaId;
  if (personaId === undefined) {
    logger.debug(
      '[CrossChannelHistoryFetcher] No personaId found in current history, skipping cross-channel'
    );
    return undefined;
  }

  const groups = await fetchCrossChannelHistory({
    personaId,
    personalityId: opts.personality.id,
    currentChannelId: opts.channelId,
    remainingBudget,
    discordClient: opts.discordClient,
    conversationHistoryService: opts.conversationHistoryService,
  });

  return groups.length > 0 ? groups : undefined;
}

/** Map resolved cross-channel groups to the API format expected by MessageContext */
export function mapCrossChannelToApiFormat(groups: ResolvedCrossChannelGroup[]): {
  channelEnvironment: DiscordEnvironment;
  messages: {
    id: string;
    role: MessageRole;
    content: string;
    tokenCount?: number;
    createdAt: string;
    personaId?: string;
    personaName?: string;
    discordUsername?: string;
    personalityId?: string;
    personalityName?: string;
  }[];
}[] {
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
