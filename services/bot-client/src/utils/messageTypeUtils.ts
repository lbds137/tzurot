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
 */

import type { Message } from 'discord.js';
import { MessageType, MessageReferenceType } from 'discord.js';

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

  // Also allow forwarded messages (have Forward reference type with snapshots)
  // Forwarded messages may have a different MessageType but contain user content
  // The ?.size check handles both undefined and size > 0 (0 is falsy)
  if (message.reference?.type === MessageReferenceType.Forward && message.messageSnapshots?.size) {
    return true;
  }

  return false;
}

/**
 * Check if a message is a forwarded message.
 *
 * Forwarded messages have:
 * - message.reference.type === MessageReferenceType.Forward
 * - message.messageSnapshots with at least one snapshot
 *
 * The actual content is in the snapshot, not in message.content.
 */
export function isForwardedMessage(message: Message): boolean {
  return (
    message.reference?.type === MessageReferenceType.Forward &&
    message.messageSnapshots !== undefined &&
    message.messageSnapshots.size > 0
  );
}

/**
 * Type guard to safely extract content from a message snapshot.
 * Snapshots have a nested message.content structure that needs careful access.
 */
function getSnapshotContent(snapshot: unknown): string | undefined {
  if (
    snapshot !== null &&
    typeof snapshot === 'object' &&
    'message' in snapshot &&
    snapshot.message !== null &&
    typeof snapshot.message === 'object' &&
    'content' in snapshot.message &&
    typeof snapshot.message.content === 'string' &&
    snapshot.message.content.length > 0
  ) {
    return snapshot.message.content;
  }
  return undefined;
}

/**
 * Get the effective content from a message.
 *
 * For regular messages: returns message.content
 * For forwarded messages: returns the content from the first snapshot
 *
 * This should be used by processors instead of directly accessing message.content
 * to ensure forwarded messages are handled correctly.
 */
export function getEffectiveContent(message: Message): string {
  // For forwarded messages, extract content from the first snapshot
  if (isForwardedMessage(message)) {
    const firstSnapshot = message.messageSnapshots?.first();
    const snapshotContent = getSnapshotContent(firstSnapshot);
    if (snapshotContent !== undefined) {
      return snapshotContent;
    }
  }

  return message.content;
}
