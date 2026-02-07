/**
 * Channel List Types and Constants
 */

import type { ChannelSettings } from '@tzurot/common-types';

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
