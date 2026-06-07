/**
 * Cross-Channel History Fetcher
 *
 * Fetches conversation history from other channels where the same user+personality
 * have interacted. Used to fill unused context budget when the current channel
 * has fewer messages than maxMessages.
 */

import { type Client, ChannelType } from 'discord.js';
import {
  ConversationHistoryService,
  buildFallbackEnvironment,
  createLogger,
  type DiscordEnvironment,
  type ResolvedCrossChannelGroup,
} from '@tzurot/common-types';

const logger = createLogger('CrossChannelHistoryFetcher');

// The wire mapping (mapCrossChannelToApiFormat) and the group/environment
// shapes live in common-types (crossChannelEnvironment.ts) — shared with
// ai-worker's assembler. Import them from '@tzurot/common-types' directly.

/** Options for fetching cross-channel history */
interface FetchOptions {
  personaId: string;
  personalityId: string;
  currentChannelId: string;
  /** Maximum number of messages to fetch across all channels (DB row limit, not token budget) */
  messageBudget: number;
  discordClient: Client;
  conversationHistoryService: ConversationHistoryService;
  /** Max-age cutoff in SECONDS, mirroring the current-channel filter. */
  maxAge?: number | null;
  /** Explicit context epoch from `/conversation reset`. */
  contextEpoch?: Date;
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
    logger.warn({ err: error, channelId }, 'Failed to fetch channel, using fallback environment');
    return buildFallbackEnvironment(channelId, guildId);
  }
}

/** Channel renames are rare; one cache walk per TTL window is plenty. */
const ENV_MAP_TTL_MS = 5 * 60 * 1000;
let envMapCache: { map: Record<string, DiscordEnvironment>; builtAt: number } | null = null;

/** @internal Exported for tests only — call `buildKnownChannelEnvironments` normally. */
export function clearKnownChannelEnvironmentsCache(): void {
  envMapCache = null;
}

/**
 * Build the channelId → DiscordEnvironment map from the Discord.js cache —
 * no fetches. Ships in the raw assembly envelope so the worker-side context
 * assembler can decorate its cross-channel groups with names it cannot
 * resolve itself. Coverage gaps (e.g. lazily-cached threads) are expected;
 * consumers degrade to id-only location blocks.
 *
 * Cached for ENV_MAP_TTL_MS: the cache walk runs per message while the raw
 * envelope is enabled, and channel/guild renames are rare.
 */
export function buildKnownChannelEnvironments(client: Client): Record<string, DiscordEnvironment> {
  const now = Date.now();
  if (envMapCache !== null && now - envMapCache.builtAt < ENV_MAP_TTL_MS) {
    return envMapCache.map;
  }

  const map: Record<string, DiscordEnvironment> = {};
  for (const channel of client.channels.cache.values()) {
    if ('guild' in channel && channel.guild !== null && channel.guild !== undefined) {
      map[channel.id] = buildGuildEnvironment(channel);
    }
  }

  envMapCache = { map, builtAt: now };
  return map;
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
  if (channel.isThread() && channel.parent === null) {
    logger.debug(
      { channelId: channel.id },
      'Thread parent is null (deletion race); using thread as channel'
    );
  } else if (channel.isThread() && channel.parent !== null) {
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
    logger.warn(
      { channelType: type },
      'Unmapped Discord channel type — may need explicit handling'
    );
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
    messageBudget,
    discordClient,
    conversationHistoryService,
  } = opts;

  if (messageBudget <= 0) {
    return [];
  }

  const groups = await conversationHistoryService.getCrossChannelHistory(
    personaId,
    personalityId,
    currentChannelId,
    messageBudget,
    { maxAgeSeconds: opts.maxAge, contextEpoch: opts.contextEpoch }
  );

  if (groups.length === 0) {
    logger.debug({ personaId, personalityId }, 'No cross-channel history found');
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
    'Fetched cross-channel history'
  );

  return resolvedGroups;
}

/**
 * Fetch cross-channel history if enabled.
 *
 * Cross-channel context gets its own DB-row budget (capped at `dbLimit`)
 * rather than what's left over after the current-channel fetch. The previous
 * "residual filler" model silently zeroed cross-channel out whenever the
 * current channel was full of stale rows — a privacy / continuity surprise
 * for users who had set max-age expecting cross-channel to bridge the gap.
 *
 * Token-budget enforcement still happens downstream in `ContentBudgetManager`,
 * which trims both sources to fit the model's context window. Pulling more
 * DB rows here just gives that layer real choices to make.
 */
export async function fetchCrossChannelIfEnabled(opts: {
  enabled: boolean;
  channelId: string;
  personaId: string;
  personalityId: string;
  dbLimit: number;
  discordClient: Client;
  conversationHistoryService: ConversationHistoryService;
  /** Max-age cutoff in SECONDS, threaded from the user's LLM config. */
  maxAge?: number | null;
  /** Explicit context epoch from `/conversation reset`. */
  contextEpoch?: Date;
}): Promise<ResolvedCrossChannelGroup[] | undefined> {
  if (!opts.enabled) {
    return undefined;
  }

  // Return value distinguishes three states for downstream consumers
  // (notably the diagnostic surface):
  //   undefined → feature disabled this turn
  //   []        → feature enabled, fetch ran, no eligible messages
  //   [...]     → feature enabled, found N messages
  // Collapsing []-when-enabled to undefined would hide the silent-skip case
  // where the user enabled cross-channel but the time-filter / fetch path
  // produced nothing — bugs in either are invisible without it.
  return fetchCrossChannelHistory({
    personaId: opts.personaId,
    personalityId: opts.personalityId,
    currentChannelId: opts.channelId,
    messageBudget: opts.dbLimit,
    discordClient: opts.discordClient,
    conversationHistoryService: opts.conversationHistoryService,
    maxAge: opts.maxAge,
    contextEpoch: opts.contextEpoch,
  });
}
