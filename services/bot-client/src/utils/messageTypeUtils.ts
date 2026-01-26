/**
 * Message Type Utilities
 *
 * Shared utilities for filtering Discord message types.
 * Used by both MessageHandler (to filter trigger messages) and
 * DiscordChannelFetcher (to filter context messages).
 *
 * This ensures consistent behavior:
 * - Bot only responds to user-generated content (Default, Reply, Forward)
 * - Bot ignores system messages (ThreadCreated, ChannelPinnedMessage, UserJoin, etc.)
 *
 * For forwarded message handling (content extraction, snapshot access),
 * use the centralized utilities in forwardedMessageUtils.ts
 */

import type { Message } from 'discord.js';
import { MessageType } from 'discord.js';
import { isForwardedMessage as isForwarded } from './forwardedMessageUtils.js';

/**
 * Check if a message is user-generated content that the bot should respond to.
 *
 * Returns true for:
 * - Default messages (normal user messages)
 * - Reply messages (user replies to other messages)
 * - Forwarded messages (messages forwarded from other channels/servers)
 *
 * Returns false for system messages:
 * - ThreadCreated (18) - "X started a thread"
 * - ThreadStarterMessage (21) - thread starter system message
 * - ChannelPinnedMessage (6) - "X pinned a message"
 * - UserJoin (7) - "X joined the server"
 * - GuildBoost (8-11) - boost notifications
 * - And all other system message types
 *
 * Note: ChatInputCommand (20) and ContextMenuCommand (23) are NOT filtered here
 * because they don't come through MessageCreate events - they use InteractionCreate.
 *
 * @param message - Discord message to check
 * @returns true if the message is user-generated content
 */
export function isUserContentMessage(message: Message): boolean {
  // Allow DEFAULT and REPLY message types
  if (message.type === MessageType.Default || message.type === MessageType.Reply) {
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

/**
 * Check if a message is a forwarded message.
 *
 * Re-exports from forwardedMessageUtils.ts for backward compatibility.
 * Use forwardedMessageUtils.ts directly for new code.
 *
 * @see forwardedMessageUtils.ts for more utilities:
 *   - hasForwardedSnapshots() - check if snapshots are available
 *   - extractAllForwardedContent() - comprehensive content extraction
 *   - hasForwardedContent() - check if forwarded message has content
 */
export { isForwardedMessage } from './forwardedMessageUtils.js';

/**
 * Get the effective content from a message.
 *
 * For regular messages: returns message.content
 * For forwarded messages: returns the content from the first snapshot (with fallback)
 *
 * This should be used by processors instead of directly accessing message.content
 * to ensure forwarded messages are handled correctly.
 *
 * Re-exports from forwardedMessageUtils.ts for backward compatibility.
 */
export { getEffectiveContent } from './forwardedMessageUtils.js';
