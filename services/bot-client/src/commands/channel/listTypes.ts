/**
 * Channel List Types and Constants
 */

import type { FilterToggleDisplay } from '../../utils/browse/filterRowBuilder.js';

import type { ChannelSettings } from '@tzurot/common-types/schemas/api/channel';

/** Channels per page for pagination (single guild mode) */
export const CHANNELS_PER_PAGE = 10;

/** Channels per page for all-servers mode (smaller to account for guild headers) */
export const CHANNELS_PER_PAGE_ALL_SERVERS = 8;

/**
 * Represents a page of channel settings for all-servers view
 */
export interface GuildPage {
  guildId: string;
  /** Raw name - escape with escapeMarkdown() when displaying */
  guildName: string;
  settings: ChannelSettings[];
  /** True if this continues from previous page */
  isContinuation: boolean;
  /** True if this is the last page for this guild */
  isComplete: boolean;
}

/** Browse filter: the invoking server only, or every server the bot shares. */
export type ChannelBrowseFilter = 'current' | 'all';

export const VALID_CHANNEL_FILTERS = ['current', 'all'] as const;

/** In-place filter toggle display (§3.1 affordance). */
export const FILTER_TOGGLE_DISPLAY: Record<ChannelBrowseFilter, FilterToggleDisplay> = {
  current: { label: 'Filter: This Server', shortLabel: 'This Server', emoji: '\u{1F4CD}' },
  all: { label: 'Filter: All Servers', shortLabel: 'All Servers', emoji: '\u{1F310}' },
};
