/**
 * Known-channel-environments builder.
 *
 * Builds the `channelId → DiscordEnvironment` map from the Discord.js cache and
 * ships it in the raw assembly envelope. The worker re-derives cross-channel
 * conversation history itself (its `ContextAssembler.assembleCrossChannel`
 * queries the DB and ignores any resolved history bot-client used to send), but
 * it CANNOT resolve channel/guild NAMES — it has no Discord connection. So
 * bot-client's only remaining cross-channel job is to ship these cached
 * environment names for the worker to decorate its groups with.
 *
 * (The former `fetchCrossChannelHistory` / `fetchCrossChannelIfEnabled` DB reads
 * were removed — that work is the worker's now.)
 */

import { type Client, ChannelType } from 'discord.js';
import { type DiscordEnvironment } from '@tzurot/common-types/types/schemas/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('knownChannelEnvironments');

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
