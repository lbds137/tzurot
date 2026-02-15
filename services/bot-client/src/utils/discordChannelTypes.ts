/**
 * Discord Channel Type Utilities
 *
 * Shared utilities for checking and working with Discord channel types.
 * Centralizes thread detection and parent resolution logic.
 */

import {
  type AnyThreadChannel,
  type Channel,
  ChannelType,
  type TextBasedChannel,
} from 'discord.js';

/**
 * Thread channel types that require special handling
 */
const THREAD_CHANNEL_TYPES = [
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
] as const;

/**
 * Text-based channel types that support message sending/deletion
 */
const TEXT_BASED_CHANNEL_TYPES = [
  ChannelType.DM,
  ChannelType.GuildText,
  ChannelType.GuildNews,
  ...THREAD_CHANNEL_TYPES,
] as const;

/**
 * Check if a channel is a thread (public, private, or announcement thread)
 */
export function isThreadChannel(channel: Channel | null): channel is AnyThreadChannel {
  if (!channel) {
    return false;
  }
  return (THREAD_CHANNEL_TYPES as readonly ChannelType[]).includes(channel.type);
}

/**
 * Get the parent channel of a thread, if available
 * Returns null for non-thread channels or if parent is not cached
 * Note: Parent can be TextChannel, NewsChannel, ForumChannel, or MediaChannel
 */
export function getThreadParent(channel: Channel | null): AnyThreadChannel['parent'] {
  if (!isThreadChannel(channel)) {
    return null;
  }
  return channel.parent;
}

/**
 * Get the parent channel ID of a thread.
 * Returns the parentId string for thread channels, null for non-threads.
 * Uses parentId (always available as a string snowflake) instead of parent
 * (which may not be cached and requires an API fetch).
 */
export function getThreadParentId(channel: Channel | null): string | null {
  if (!isThreadChannel(channel)) {
    return null;
  }
  return channel.parentId;
}

/**
 * Check if a channel is a text-based channel that supports message operations
 * Includes: DM, GuildText, GuildNews, and all thread types
 */
export function isTextBasedMessageChannel(channel: Channel | null): channel is TextBasedChannel {
  if (!channel) {
    return false;
  }
  return (TEXT_BASED_CHANNEL_TYPES as readonly ChannelType[]).includes(channel.type);
}
