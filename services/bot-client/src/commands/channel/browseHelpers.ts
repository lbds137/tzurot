/**
 * Channel browse pure helpers: row formatting, sorting, query filtering,
 * and the guild-page chunking for the all-servers view.
 */

import { escapeMarkdown, type Client, type TextChannel } from 'discord.js';
import { formatDiscordTimestamp } from '@tzurot/common-types/utils/dateFormatting';
import type { ChannelSettings } from '@tzurot/common-types/schemas/api/channel';
import { createListComparator, type ListSortType } from '../../utils/listSorting.js';
import type { BrowseSortType } from '../../utils/browse/index.js';
import { CHANNELS_PER_PAGE_ALL_SERVERS, type GuildPage } from './listTypes.js';

/**
 * Format a single channel settings entry for display
 */
export function formatChannelSettings(settings: ChannelSettings): string {
  const channelMention = `<#${settings.channelId}>`;
  const activatedDate = formatDiscordTimestamp(settings.createdAt, 'D');
  const safeName = escapeMarkdown(settings.personalityName ?? 'Unknown');
  return `${channelMention} → **${safeName}** (\`${settings.personalitySlug}\`)\n  _Activated: ${activatedDate}_`;
}

/**
 * Create a channel comparator with access to client cache for name lookups.
 */
export function createChannelComparator(
  client: Client
): (sortType: ListSortType) => (a: ChannelSettings, b: ChannelSettings) => number {
  const getChannelName = (s: ChannelSettings): string => {
    const channel = client.channels.cache.get(s.channelId) as TextChannel | undefined;
    return channel?.name ?? s.channelId;
  };

  return createListComparator<ChannelSettings>(getChannelName, s => s.createdAt);
}

/**
 * Sort channel settings by the specified sort type.
 */
export function sortChannelSettings(
  settings: ChannelSettings[],
  sortType: BrowseSortType,
  client: Client,
  isAllServers = false
): ChannelSettings[] {
  const sorted = [...settings];
  const comparator = createChannelComparator(client);

  const getGuildName = (s: ChannelSettings): string => {
    if (s.guildId === null) {
      return 'zzz_unknown';
    }
    const guild = client.guilds.cache.get(s.guildId);
    return guild?.name ?? s.guildId;
  };

  if (isAllServers) {
    sorted.sort((a, b) => {
      const guildCompare = getGuildName(a).localeCompare(getGuildName(b));
      if (guildCompare !== 0) {
        return guildCompare;
      }
      return comparator(sortType)(a, b);
    });
  } else {
    sorted.sort(comparator(sortType));
  }

  return sorted;
}

/**
 * Filter channel settings by query
 */
export function filterByQuery(
  settings: ChannelSettings[],
  query: string | null
): ChannelSettings[] {
  if (query === null || query.length === 0) {
    return settings;
  }

  const lowerQuery = query.toLowerCase();
  return settings.filter(
    s =>
      (s.personalityName?.toLowerCase().includes(lowerQuery) ?? false) ||
      (s.personalitySlug?.toLowerCase().includes(lowerQuery) ?? false)
  );
}

/**
 * Build guild-aware pages for all-servers view
 */
export function buildGuildPages(activations: ChannelSettings[], client: Client): GuildPage[] {
  const pages: GuildPage[] = [];

  const guildGroups: { guildId: string; guildName: string; settings: ChannelSettings[] }[] = [];
  let currentGroup: (typeof guildGroups)[0] | null = null;

  for (const activation of activations) {
    const guildId = activation.guildId ?? 'unknown';
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- explicit null check required
    if (currentGroup === null || currentGroup.guildId !== guildId) {
      const guild = guildId !== 'unknown' ? client.guilds.cache.get(guildId) : undefined;
      const guildName: string = guild?.name ?? `Unknown Server (${guildId})`;
      currentGroup = { guildId, guildName, settings: [] };
      guildGroups.push(currentGroup);
    }
    currentGroup.settings.push(activation);
  }

  for (const group of guildGroups) {
    const totalChannels = group.settings.length;
    let offset = 0;

    while (offset < totalChannels) {
      const pageSettings = group.settings.slice(offset, offset + CHANNELS_PER_PAGE_ALL_SERVERS);
      const isContinuation = offset > 0;
      const isComplete = offset + pageSettings.length >= totalChannels;

      pages.push({
        guildId: group.guildId,
        guildName: group.guildName,
        settings: pageSettings,
        isContinuation,
        isComplete,
      });

      offset += CHANNELS_PER_PAGE_ALL_SERVERS;
    }
  }

  return pages;
}
