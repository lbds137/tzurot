/**
 * Reference Extraction Types
 *
 * Lightweight DTOs to reduce Discord.js dependencies and improve testability
 */

/**
 * Reference type enum
 */
export enum ReferenceType {
  REPLY = 'REPLY',
  LINK = 'LINK',
  FORWARD = 'FORWARD',
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
