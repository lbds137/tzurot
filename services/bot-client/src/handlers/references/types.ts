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
}

// Re-export the canonical `isForwardedMessage` so existing imports from this
// module keep working. The canonical implementation in `forwardedMessageUtils`
// handles `null | undefined` and has a `messageSnapshots` fallback for cases
// where Discord.js doesn't populate `reference.type` correctly. Previously
// this file had its own narrower implementation, which `guard:duplicate-exports`
// surfaced as a divergence risk.
export { isForwardedMessage } from '../../utils/forwardedMessageUtils.js';

/**
 * Raw reference result from strategy extraction
 */
export interface ReferenceResult {
  /** Discord message ID */
  messageId: string;
  /** Discord channel ID */
  channelId: string;
  /** Discord guild ID — null for DM channels (matches discord.js Message#guildId semantics) */
  guildId: string | null;
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
  /** True when the reference was found in conversation history (dedup stub) */
  isDeduplicated?: boolean;
}
