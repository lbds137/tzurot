/**
 * Reference Extraction Types
 *
 * Lightweight DTOs to reduce Discord.js dependencies and improve testability
 */

import type { Message } from 'discord.js';
import { MessageReferenceType } from 'discord.js';

/**
 * Reference type enum
 */
export enum ReferenceType {
  REPLY = 'REPLY',
  LINK = 'LINK',
  FORWARD = 'FORWARD',
}

/**
 * Check if a Discord message is a forwarded message with snapshots.
 * Centralizes the Discord.js MessageReferenceType.Forward check.
 */
export function isForwardedMessage(message: Message): boolean {
  return (
    message.reference?.type === MessageReferenceType.Forward &&
    (message.messageSnapshots?.size ?? 0) > 0
  );
}

/**
 * Raw reference result from strategy extraction
 */
export interface ReferenceResult {
  /** Discord message ID */
  messageId: string;
  /** Discord channel ID */
  channelId: string;
  /** Discord guild ID */
  guildId: string;
  /** Type of reference */
  type: ReferenceType;
  /** Discord URL (for link replacement) */
  discordUrl?: string;
}

/**
 * Metadata about a reference for BFS traversal
 */
export interface ReferenceMetadata {
  /** Discord message ID */
  messageId: string;
  /** BFS depth level */
  depth: number;
  /** Message timestamp */
  timestamp: Date;
  /** Discord URL (for link replacement) */
  discordUrl?: string;
}
