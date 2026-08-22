/**
 * Message Type Utilities
 *
 * Shared utilities for filtering Discord message types.
 * Used by both MessageHandler (to filter trigger messages) and
 * DiscordChannelFetcher (to filter context messages).
 *
 * This ensures consistent behavior:
 * - Both admit real channel content (Default, Reply, Forward, and the
 *   ChatInputCommand/ContextMenuCommand shapes app-bots use to answer commands)
 * - Both ignore system messages (ThreadCreated, ChannelPinnedMessage, UserJoin, etc.)
 *
 * Admitting a message is not the same as replying to it: bot-authored messages pass
 * this filter and are then dropped by BotMessageFilter on the trigger path, while
 * still being eligible for extended context.
 *
 * For forwarded message handling (content extraction, snapshot access),
 * use the centralized utilities in forwardedMessageUtils.ts
 */

import { type Message, MessageType } from 'discord.js';
import { isForwardedMessage as isForwarded } from './forwardedMessageUtils.js';

/**
 * Check if a message carries real channel content rather than a system notice.
 *
 * Returns true for:
 * - Default messages (normal user messages)
 * - Reply messages (user replies to other messages)
 * - Forwarded messages (messages forwarded from other channels/servers)
 * - ChatInputCommand / ContextMenuCommand messages (an application bot's
 *   response to a slash/context-menu command)
 *
 * Returns false for system messages:
 * - ThreadCreated (18) - "X started a thread"
 * - ThreadStarterMessage (21) - thread starter system message
 * - ChannelPinnedMessage (6) - "X pinned a message"
 * - UserJoin (7) - "X joined the server"
 * - GuildBoost (8-11) - boost notifications
 * - And all other system message types
 *
 * Note: ChatInputCommand (20) and ContextMenuCommand (23) ARE admitted here.
 * These tag an ordinary channel message an application bot posted in answer to a
 * command — it is that bot "speaking" in the channel, just labelled with the
 * command shape that prompted it. Both consumers see such messages (MessageHandler
 * off the live event, DiscordChannelFetcher off the channel-history fetch), so
 * rejecting the types dropped that content — embed-only replies included — before
 * extraction ever ran. Admission is pinned by messageTypeUtils.test.ts; that it
 * creates no new trigger surface (BotMessageFilter still stops bot authors) is
 * pinned by the trigger-path tests in MessageHandler.test.ts.
 *
 * @param message - Discord message to check
 * @returns true if the message carries channel content rather than a system notice
 */
export function isUserContentMessage(message: Message): boolean {
  // Allow DEFAULT, REPLY, and command-response message types
  if (
    message.type === MessageType.Default ||
    message.type === MessageType.Reply ||
    message.type === MessageType.ChatInputCommand ||
    message.type === MessageType.ContextMenuCommand
  ) {
    return true;
  }

  // Also allow forwarded messages (have Forward reference type)
  // Forwarded messages may have a different MessageType but contain user content
  // Note: We don't require messageSnapshots.size > 0 because Discord may not always
  // populate snapshots (permissions, API limitations, etc.)
  // Uses centralized isForwardedMessage from forwardedMessageUtils.ts
  if (isForwarded(message)) {
    return true;
  }

  return false;
}
