/**
 * Discord Channel Types
 *
 * Centralized type definitions for Discord.js channel types.
 * Prevents duplication and ensures consistency across services.
 */

import type {
  Message,
  TextChannel,
  DMChannel,
  NewsChannel,
  PublicThreadChannel,
  PrivateThreadChannel,
} from 'discord.js';
import { ChannelType } from 'discord.js';

/**
 * Channels that support typing indicators
 *
 * Used by JobTracker and PersonalityMessageHandler to validate
 * that a channel supports the sendTyping() API.
 */
export type TypingChannel =
  | TextChannel
  | DMChannel
  | NewsChannel
  | PublicThreadChannel
  | PrivateThreadChannel;

/**
 * Type guard to check if a channel supports typing indicators
 *
 * @param channel - Discord channel to check
 * @returns true if channel supports sendTyping()
 *
 * @example
 * ```ts
 * if (isTypingChannel(message.channel)) {
 *   await message.channel.sendTyping();
 * }
 * ```
 */
export function isTypingChannel(channel: Message['channel']): channel is TypingChannel {
  return (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.DM ||
    channel.type === ChannelType.GuildNews ||
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread
  );
}
